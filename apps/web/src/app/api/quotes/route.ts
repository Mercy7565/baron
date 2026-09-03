import { affordableHintBps, type Campaign, pick } from "@countersign/campaigns";
import { priceCart, recommendationCandidates } from "@countersign/catalog";
import { guardCart } from "@countersign/guard";
import { evaluate } from "@countersign/kernel";
import { buildOrderNotes } from "@countersign/ledger";
import { checkAgainstIntent } from "@countersign/mandates";
import {
  type Quote,
  type QuoteLine,
  QUOTE_TTL_MS,
  appendQuote,
  computeLegalTotal,
  quoteId,
} from "@countersign/quotes";

import { CAMPAIGNS, campaignById, isCampaignActive } from "@/lib/campaigns";
import { CATALOG } from "@/lib/catalog";
import { DEV_POLICY } from "@/lib/policy";
import { bestClearableBps } from "@/server/coupons";
import { cartFingerprint } from "@/server/fingerprint";
import { lookupMandate, mandateRequiredResponse } from "@/server/mandates";
import { buyerId } from "@/server/require-role";

/** The rung the kernel actually chose, so its rupee cap can be enforced. */
function chosenRung(offerIds: string[]) {
  const id = offerIds[0];
  return id === undefined ? null : (DEV_POLICY.ladder.find((r) => r.offer_id === id) ?? null);
}


export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Keys a caller may legitimately send. Everything else is named and dropped —
 * and crucially, every *money* key is on the forbidden list, because the total
 * is ours to compute and never theirs to assert.
 */
const ALLOWED_FIELDS = new Set([
  "buyer_user_id",
  "agent_id",
  "mandate_hash",
  "intent_text",
  "upsell_accepted",
  "sku_lines",
  "gift_lines",
  "requested_discount_bps",
]);

/**
 * Money-shaped keys we refuse on sight. Named individually so the rejection
 * reads as a decision rather than an accident.
 */
const PRICE_KEYS = new Set([
  "amount_paise",
  "total",
  "total_paise",
  "requested_total_paise",
  "legal_total_paise",
  "price",
  "price_paise",
  "unit_price_paise",
  "subtotal_paise",
  "currency",
  "offer_id",
  "requested_offer_id",
  "applied_bps",
]);

interface QuoteRequest {
  buyer_user_id?: string;
  agent_id?: string;
  mandate_hash?: string | null;
  intent_text?: string | null;
  sku_lines?: Array<{ sku_id?: string; qty?: number }>;
  requested_discount_bps?: number;
}

/**
 * POST /api/quotes
 *
 * Produces a quote: a priced, bounded, time-limited offer. It runs guard,
 * campaigns and the kernel, and it does not capture, does not create a Razorpay
 * order, and does not touch the vault.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const raw = (typeof body === "object" && body !== null ? body : {}) as QuoteRequest &
    Record<string, unknown>;

  // A signed-in customer owns their orders; an outside agent falls back to the
  // shared demo buyer so the API still works without our cookie.
  const sessionBuyer = await buyerId();

  // ---------------------------------------------------------------- 402 first
  //
  // Before any pricing, any kernel call, any persistence. A caller without a
  // mandate learns that and nothing else.
  const bundle = lookupMandate(raw.mandate_hash ?? null);
  if (bundle === null) {
    return Response.json(
      { error: "mandate_required", continue_url: "/cart" },
      {
        status: 402,
        headers: {
          "payment-required": 'ap2-intent-hash realm="countersign"',
          "cache-control": "no-store",
        },
      },
    );
  }

  // ------------------------------------------------------- discard their money

  const ignored_inputs: string[] = [];

  for (const key of Object.keys(raw)) {
    if (ALLOWED_FIELDS.has(key)) continue;
    ignored_inputs.push(
      PRICE_KEYS.has(key)
        ? `${key} (caller-supplied money value, discarded — totals come from the catalog)`
        : `${key} (unknown field, dropped)`,
    );
  }

  // A price hidden inside a line item is the same attack wearing a hat.
  const requestedLines = Array.isArray(raw.sku_lines) ? raw.sku_lines : [];
  for (const [i, line] of requestedLines.entries()) {
    if (typeof line !== "object" || line === null) continue;
    for (const key of Object.keys(line)) {
      if (key === "sku_id" || key === "qty") continue;
      ignored_inputs.push(`sku_lines[${i}].${key} (caller-supplied line value, discarded)`);
    }
  }

  // ------------------------------------------------------------------- resolve

  const lines = requestedLines
    .map((l) => ({ sku_id: String(l?.sku_id ?? ""), qty: Number(l?.qty ?? 1) }))
    .filter((l) => l.sku_id !== "");

  /**
   * What the caller explicitly asked for, if anything.
   *
   * `null` means "give this basket whatever it can have", which is what the
   * shop's own agent now sends. Only a caller that names a figure — /lab, or an
   * outside agent trying its luck — can produce a CLAMP, because only then has
   * anyone actually asked for more than policy allows.
   */
  const explicitAsk = Number.isInteger(raw.requested_discount_bps)
    ? Number(raw.requested_discount_bps)
    : null;

  /**
   * Gift lines, and where each paid line came from.
   *
   * A gift is priced at zero and must never reach the kernel as an amount, so
   * it travels beside the priced lines rather than among them.
   */
  const giftLines: Array<{ sku_id: string; title: string; qty: number; unit_price_paise: number; from_campaign_id: string | null }> =
    (Array.isArray(raw.gift_lines) ? raw.gift_lines : [])
      .map((g) => {
        const gl = g as { sku_id?: string; qty?: number; from_campaign_id?: string };
        const product = CATALOG.products.find((p) => p.id === gl.sku_id);
        if (product === undefined) return null;
        return {
          sku_id: product.id,
          title: product.title,
          qty: Math.max(1, Number(gl.qty ?? 1)),
          // The catalog price is what the gift costs the campaign, even though
          // the shopper pays nothing for it.
          unit_price_paise: product.price_paise,
          from_campaign_id: typeof gl.from_campaign_id === "string" ? gl.from_campaign_id : null,
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);

  const lineOrigins: Record<string, string> = {};
  for (const l of requestedLines) {
    const src = (l as { from_campaign_id?: string }).from_campaign_id;
    const sku = String(l?.sku_id ?? "");
    if (typeof src === "string" && src !== "" && sku !== "") lineOrigins[sku] = src;
  }

  const guardInput = {
    catalog: CATALOG,
    currency: "INR",
    quoted_amount_paise: null,
    free_text: raw.intent_text ?? null,
    blocked_product_ids: DEV_POLICY.blocked_product_ids,
  } as const;

  let guarded = guardCart({ ...guardInput, lines });

  /**
   * One bad line must not cost a shopper their whole basket.
   *
   * The guard refuses per SKU — hallucinated, out of stock, blocked — and it
   * used to take the entire cart down with it. So a shopper who asked for three
   * things and one of them was denylisted lost the two that were fine, which is
   * both hostile and a lie about what policy actually decided.
   *
   * Here the refused SKUs are dropped and the rest is re-guarded. Each refusal
   * is still reported with its real mistake code, so nothing is hidden — the
   * good lines simply survive.
   */
  const refusedSkus: Array<{ sku_id: string; code: string; message: string }> = [];

  if (!guarded.ok || guarded.cart === null) {
    for (const f of guarded.findings) {
      if (f.disposition !== "REJECT") continue;
      const sku = f.detail.sku_id;
      if (typeof sku !== "string" || sku === "") continue;
      if (refusedSkus.some((r) => r.sku_id === sku)) continue;
      refusedSkus.push({ sku_id: sku, code: f.code, message: f.message });
    }

    const survivors = lines.filter(
      (l) => !refusedSkus.some((r) => r.sku_id === l.sku_id),
    );

    // Only re-guard if dropping the bad lines leaves something to price. A
    // basket that was entirely bad is still a refusal.
    if (refusedSkus.length > 0 && survivors.length > 0) {
      const retry = guardCart({ ...guardInput, lines: survivors });
      if (retry.ok && retry.cart !== null) {
        guarded = retry;
        for (const r of refusedSkus) {
          ignored_inputs.push(`${r.sku_id} refused (${r.code}) — the rest of the basket was priced`);
        }
      }
    }
  }

  const mistakes_repaired = guarded.findings.map((f) => `${f.code}:${f.disposition}`);
  ignored_inputs.push(...guarded.ignored_inputs);

  if (!guarded.ok || guarded.cart === null) {
    // Nothing survived. Name the actual code rather than "policy refused that
    // basket", which told a shopper nothing they could act on.
    const first = refusedSkus[0] ?? null;
    const worst = guarded.findings.find((f) => f.disposition === "REJECT") ?? null;

    return Response.json(
      {
        quote_id: null,
        verdict: "REJECT",
        reason_code: first?.code ?? worst?.code ?? "guard_refused",
        reason: first?.message ?? worst?.message ?? "The basket did not survive validation against the catalog.",
        refused_skus: refusedSkus,
        mistakes_repaired,
        ignored_inputs,
        mistakes: guarded.findings,
      },
      { status: 200 },
    );
  }

  const cart = guarded.cart;

  // ------------------------------------------------------------------ campaign

  const live: Campaign[] = CAMPAIGNS.map((c) => ({ ...c, active: isCampaignActive(c.id) }));
  const campaign = pick(live, CATALOG, cart, new Date());
  const campaignId = campaign.campaign?.id ?? null;

  // A campaign is a hint, and a budget. It never supplies an offer id, and it
  // may only hint as high as its remaining spend ceiling can actually fund — a
  // campaign that quietly overspends is a merchant-side failure even when every
  // individual order was legal.
  const affordable =
    campaign.campaign === null ? 0 : affordableHintBps(campaign.campaign, cart.amount_paise);

  if (campaign.campaign !== null && affordable < campaign.campaign.max_discount_bps_hint) {
    ignored_inputs.push(
      `campaign ${campaign.campaign.id} hint ${campaign.campaign.max_discount_bps_hint} bps reduced to ${affordable} bps (spend ceiling)`,
    );
  }

  // With no explicit ask, the house asks for the best coupon this basket can
  // clear — so the quote reads ALLOW rather than a CLAMP nobody caused. A
  // campaign can no longer raise this past what the cart and the floor allow;
  // its job is to suggest a product, not to move the charged percentage.
  const askedBps = explicitAsk ?? bestClearableBps(cart.amount_paise, cart.margin_bps);
  const hintedBps = explicitAsk === null ? askedBps : Math.max(askedBps, affordable);

  // ------------------------------------------------------------------ mandate

  const intentCheck = checkAgainstIntent(
    bundle.intent,
    cart.amount_paise,
    hintedBps,
    cart.product_ids,
    new Date(),
  );

  if (!intentCheck.valid) {
    return Response.json(
      {
        quote_id: null,
        verdict: "REJECT",
        reason: intentCheck.message,
        mistakes_repaired,
        ignored_inputs,
      },
      { status: 200 },
    );
  }

  if (intentCheck.discount_clamped) {
    ignored_inputs.push(
      `requested_discount_bps=${hintedBps} (above mandate ceiling ${bundle.intent.max_discount_bps}, reduced)`,
    );
  }

  // -------------------------------------------------------------------- kernel

  const proposal = {
    cart_id: `quote_${raw.buyer_user_id ?? "anon"}`,
    amount_paise: cart.amount_paise,
    currency: "INR" as const,
    requested_discount_bps: intentCheck.allowed_discount_bps,
    // The kernel owns offer ids. A caller cannot name one here at all.
    requested_offer_id: null,
    product_ids: cart.product_ids,
    margin_bps: cart.margin_bps,
  };

  const verdict = evaluate(proposal, DEV_POLICY);
  ignored_inputs.push(...verdict.ignored_inputs);

  // A refusal produces no quote: there is nothing to hold or approve.
  if (verdict.verdict === "REJECT" || verdict.verdict === "ESCALATE") {
    return Response.json(
      {
        quote_id: null,
        verdict: verdict.verdict,
        reason: verdict.reasons.message,
        mistakes_repaired,
        ignored_inputs,
      },
      { status: 200 },
    );
  }

  // --------------------------------------------------------------- the quote

  const quoteLines: QuoteLine[] = cart.lines.map((l) => ({
    sku_id: l.sku_id,
    title: l.title,
    qty: l.qty,
    unit_price_paise: l.unit_price_paise,
    line_total_paise: l.line_total_paise,
  }));

  // Catalog price x qty, less the discount the kernel allowed. Nothing else.
  const { subtotal_paise, legal_total_paise } = computeLegalTotal(
    quoteLines,
    verdict.applied_discount_bps,
    chosenRung(verdict.offer_ids)?.max_discount_paise ?? null,
  );

  const now = new Date();
  const id = quoteId(
    `${raw.buyer_user_id ?? "anon"}:${now.toISOString()}:${JSON.stringify(quoteLines)}`,
  );

  // quote_id rides in inputs_hash extras, exactly as campaign_id already does.
  // No fifth key is added to order notes.
  const notes = buildOrderNotes(proposal, DEV_POLICY, verdict, {
    ...(campaignId === null ? {} : { campaign_id: campaignId }),
    quote_id: id,
  });

  const upsell = recommendationCandidates(CATALOG, lines)
    .filter((c) => {
      const projected = priceCart(CATALOG, [...lines, { sku_id: c.id, qty: 1 }]);
      return (
        projected.amount_paise <= DEV_POLICY.max_order_paise &&
        projected.margin_bps >= DEV_POLICY.margin_floor_bps
      );
    })
    .slice(0, 2)
    .map((c) => ({
      sku_id: c.id,
      title: c.title,
      price_paise: c.price_paise,
      reason: "Pairs with the basket and stays inside the cap and the margin floor.",
    }));

  const quote: Quote = {
    quote_id: id,
    status: "quoted",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),

    buyer_user_id: sessionBuyer !== "demo" ? sessionBuyer : String(raw.buyer_user_id ?? "demo"),
    agent_id: String(raw.agent_id ?? "unknown"),
    mandate_hash: String(raw.mandate_hash ?? ""),

    lines: quoteLines,
    subtotal_paise,
    legal_total_paise,

    asked_bps: askedBps,
    applied_bps: verdict.applied_discount_bps,
    offer_id: verdict.offer_ids[0] ?? null,

    campaign_id: campaignId,
    cart_fingerprint: cartFingerprint(quoteLines.map((l) => ({ sku_id: l.sku_id, qty: l.qty }))),
    // Gifts ride along on the quote so the order, the receipt and the burn all
    // see them. They are appended after pricing and never enter any total.
    ...(giftLines.length === 0 ? {} : { gift_lines: giftLines }),
    // Which campaign put each paid line in the bag, so a payment can be
    // attributed to the campaign that caused it.
    ...(Object.keys(lineOrigins).length === 0 ? {} : { line_origins: lineOrigins }),
    intent_text: typeof raw.intent_text === "string" ? raw.intent_text : null,
    upsell_accepted: typeof raw.upsell_accepted === "boolean" ? raw.upsell_accepted : null,
    decision_id: notes.decision_id,
    verdict: verdict.verdict,

    upsell,
    mistakes_repaired,
    ignored_inputs,

    payment_id: null,
    order_id: null,
    superseded_by: null,
    payment_link_id: null,
    payment_link_short_url: null,
  };

  appendQuote(quote);

  return Response.json(
    {
      quote_id: quote.quote_id,
      subtotal_paise: quote.subtotal_paise,
      legal_total_paise: quote.legal_total_paise,
      asked_bps: quote.asked_bps,
      applied_bps: quote.applied_bps,
      offer_id: quote.offer_id,
      upsell: quote.upsell,
      expires_at: quote.expires_at,
      mistakes_repaired: quote.mistakes_repaired,
      ignored_inputs: quote.ignored_inputs,
      verdict: quote.verdict,
      // Lines that were refused while the rest of the basket was priced. Empty
      // on a clean quote; never silently dropped.
      refused_skus: refusedSkus,
      campaign_id: quote.campaign_id,
      // Named, not just keyed, so the shopper-facing explanation can say which
      // campaign whispered without the client holding a copy of the roster.
      campaign_name: campaignId === null ? null : (campaignById(campaignId)?.name ?? null),
      // One sentence for why the applied rung is what it is.
      reason: verdict.reasons.message,
    },
    { status: 200 },
  );
}
