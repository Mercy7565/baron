import {
  add_to_cart,
  apply_campaign,
  get_cart,
  propose_money_action,
  remove_from_cart,
  resolveSku,
  search_catalog,
  suggest_upsell,
} from "@/server/tools";
import { payable, readBasket, writeBasket, type BasketLine } from "@/server/cart";
import { enteredCode } from "@/server/shop-code";
import { requireShopCode } from "@/server/shop-code";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/agent/chat
 *
 * A deliberately dumb agent: rule-based intent parsing, no model call. That is
 * the point of the demo — the agent can be as naive (or as compromised) as you
 * like, because it has no authority. Every money-adjacent thing it does goes
 * through a tool, and the only tool that touches money is an HTTP call to
 * /api/checkout/propose.
 */

interface Step {
  /**
   * "tool" is a tool call with evidence; "agent" is something the agent says to
   * the shopper. A refusal has to be the second kind — a tool row with an empty
   * result reads as debug output, not as an answer.
   */
  role?: "agent" | "tool";
  tool: string;
  input: unknown;
  output: unknown;
  say?: string;
}

/** What the agent says when it will not invent a product. */
const NOT_FOUND_REPLY = "I could not find that product, so I am not adding anything.";

/** "15%", "15 percent", "15 % off" → 1500 bps. */
function parseDiscountBps(text: string): number | null {
  const m = /(\d{1,2})\s*(%|percent)/i.exec(text);
  if (m === null) return null;
  const pct = Number(m[1]);
  if (!Number.isInteger(pct) || pct < 0 || pct > 99) return null;
  return pct * 100;
}

/** "make it 1 rupee", "₹499" → paise the agent said out loud. */
function parseQuotedPaise(text: string): number | null {
  const m = /(?:₹|rs\.?\s*|rupees?\s*)(\d+(?:\.\d{1,2})?)/i.exec(text);
  if (m === null) return null;
  const rupees = Number(m[1]);
  if (!Number.isFinite(rupees)) return null;
  return Math.round(rupees * 100);
}

function wants(text: string, ...words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w));
}

export async function POST(request: Request): Promise<Response> {
  // Every branch below this line searches, adds, suggests or proposes money.
  // None of them may run for a browser that has not named a shop.
  const blind = await requireShopCode();
  if (blind !== null) return blind;

  let payload: { message?: string; cart_id?: string; mandate_hash?: string | null };
  try {
    payload = (await request.json()) as {
      message?: string;
      cart_id?: string;
      mandate_hash?: string | null;
    };
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const message = payload.message ?? "";
  // The basket travels in the shopper's cookie. `cart_id` survives only as a
  // label on the audit trail; it is not a lookup key any more.
  const shopCode = await enteredCode();
  const cartId = payload.cart_id ?? "cart_cookie";
  let bag: BasketLine[] = await readBasket(shopCode);
  const steps: Step[] = [];

  // --- search, if the shopper named something ------------------------------

  const searchMatch = /(?:find|search|show me|looking for|do you have)\s+(.+?)(?:[.?!]|$)/i.exec(
    message,
  );
  if (searchMatch !== null) {
    const q = (searchMatch[1] ?? "").trim();
    const results = search_catalog(q, 3);
    steps.push({
      tool: "search_catalog",
      input: { query: q },
      output: results.map((p) => ({ id: p.id, title: p.title, price_paise: p.price_paise })),
      say:
        results.length > 0
          ? `Found ${results.length} match${results.length === 1 ? "" : "es"} for "${q}".`
          : `Nothing in the catalog matches "${q}".`,
    });
  }

  // --- add / remove --------------------------------------------------------

  const addMatch = /add(?:\s+the)?\s+(.+?)(?:\s+to\s+(?:my\s+)?cart)?(?:[.,]|$)/i.exec(message);
  if (addMatch !== null && wants(message, "add")) {
    const raw = (addMatch[1] ?? "").trim();

    // "add the upgrade" is resolved from the catalog, never invented.
    if (/^(the\s+)?(upgrade|upsell|suggestion)$/i.test(raw)) {
      const suggestions = suggest_upsell(bag);
      const first = suggestions[0];
      if (first !== undefined) {
        const out = add_to_cart(bag, first.sku_id, 1);
        bag = out.lines;
        steps.push({
          tool: "suggest_upsell",
          input: { cart_id: cartId },
          output: suggestions,
          say: first.reason,
        });
        steps.push({
          tool: "add_to_cart",
          input: { sku_id: first.sku_id, qty: 1 },
          output: out.cart,
          say: `Added ${first.title}.`,
        });
      } else {
        steps.push({
          tool: "suggest_upsell",
          input: { cart_id: cartId },
          output: [],
          say: "No upgrade is available that stays inside the cap and the margin floor.",
        });
      }
    } else {
      const product = resolveSku(raw);
      if (product === null) {
        // The evidence: we looked, and nothing matched well enough to be that
        // product. Substituting a near-match here would be the agent inventing
        // a purchase, so it does not happen.
        steps.push({
          role: "tool",
          tool: "search_catalog",
          input: { query: raw },
          output: { matches: [], resolved: null, reason: "no confident match" },
        });
        // The answer, in the agent's own voice.
        steps.push({
          role: "agent",
          tool: "",
          input: null,
          output: null,
          say: NOT_FOUND_REPLY,
        });
      } else {
        const out = add_to_cart(bag, product.id, 1);
        bag = out.lines;
        steps.push({
          tool: "add_to_cart",
          input: { sku_id: product.id, qty: 1 },
          output: out.cart,
          say: `Added ${product.title}.`,
        });
      }
    }
  }

  const removeMatch = /remove\s+(?:the\s+)?(.+?)(?:\s+from\s+(?:my\s+)?cart)?(?:[.,]|$)/i.exec(
    message,
  );
  if (removeMatch !== null && wants(message, "remove")) {
    const product = resolveSku((removeMatch[1] ?? "").trim());
    if (product !== null) {
      const out = remove_from_cart(bag, product.id);
      bag = out.lines;
      steps.push({
        tool: "remove_from_cart",
        input: { sku_id: product.id },
        output: out.cart,
        say: `Removed ${product.title}.`,
      });
    }
  }

  // --- upsell on request ---------------------------------------------------

  if (wants(message, "upsell", "recommend", "suggest", "what else", "anything else")) {
    const suggestions = suggest_upsell(bag);
    steps.push({
      tool: "suggest_upsell",
      input: { cart_id: cartId },
      output: suggestions,
      say:
        suggestions.length > 0
          ? suggestions.map((s) => `${s.title}: ${s.reason}`).join(" ")
          : "Nothing to suggest that keeps the cart inside policy.",
    });
  }

  // --- campaign ------------------------------------------------------------

  const campaign = apply_campaign(bag);
  if (campaign.campaign !== null || campaign.stale.length > 0) {
    steps.push({
      tool: "apply_campaign",
      input: { cart_id: cartId },
      output: {
        picked: campaign.campaign?.id ?? null,
        hint_bps: campaign.campaign?.max_discount_bps_hint ?? null,
        eligible: campaign.eligible.map((c) => c.id),
        stacking: campaign.stacking,
        stale: campaign.stale.map((c) => c.id),
      },
      say: campaign.note,
    });
  }

  // --- propose -------------------------------------------------------------

  const askedBps = parseDiscountBps(message);
  const quoted = parseQuotedPaise(message);
  // A quoted price counts as intent: that is exactly the price_drift case we
  // need to reach the money path so the catalog can overrule it.
  const wantsCheckout =
    askedBps !== null || quoted !== null || wants(message, "checkout", "pay", "buy", "propose");

  if (wantsCheckout) {
    const cart = get_cart(bag);

    if (cart.lines.length === 0) {
      steps.push({
        tool: "get_cart",
        input: { cart_id: cartId },
        output: cart.cart,
        say: "The cart is empty, so there is nothing to propose.",
      });
    } else {
      // The campaign hint may raise what we ask for, never what is granted.
      const hint = campaign.campaign?.max_discount_bps_hint ?? 0;
      const requested = Math.max(askedBps ?? 0, hint);

      const result = await propose_money_action({
        cart_id: cartId,
        lines: bag,
        requested_discount_bps: requested,
        // Anything the shopper typed rides along as free text and is inert.
        free_text: message,
        // If a price was spoken, it is sent to be compared and discarded.
        quoted_amount_paise: quoted,
        campaign_id: campaign.campaign?.id ?? null,
        mandate_hash: payload.mandate_hash ?? null,
      });

      steps.push({
        tool: "propose_money_action",
        input: {
          cart_id: cartId,
          requested_discount_bps: requested,
          campaign_id: campaign.campaign?.id ?? null,
          quoted_amount_paise: quoted,
        },
        output: result.body,
        say: `Proposed ${requested} bps. The kernel decides from here.`,
      });
    }
  }

  if (steps.length === 0) {
    const cart = get_cart(bag);
    steps.push({
      tool: "get_cart",
      input: { cart_id: cartId },
      output: cart.cart,
      say: 'Try: "add the niacinamide serum", "what else?", or "15% off and add the upgrade".',
    });
  }

  // One write per request. The bag above is the only copy that mattered; this
  // is where it becomes the shopper's cookie again.
  if (shopCode !== null) await writeBasket(shopCode, bag);

  return Response.json({ cart_id: cartId, steps }, { status: 200 });
}
