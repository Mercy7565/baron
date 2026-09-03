/**
 * The agent's tool surface.
 *
 * Hard rule for this file: it must never import @countersign/razorpay, and it
 * must never construct an offer id. `propose_money_action` reaches money the
 * same way an outside bot would — by HTTP to /api/checkout/propose — so the
 * in-app agent has no privileged path.
 */
import {
  type Product,
  priceCart,
  lookupSkus as lookupSkusPure,
  productById,
  recommendationCandidates,
  searchCatalog,
} from "@countersign/catalog";
import { type Campaign, pick } from "@countersign/campaigns";

import { CAMPAIGNS, isCampaignActive } from "@/lib/campaigns";
import { CATALOG, baseUrl } from "@/lib/catalog";
import { DEV_POLICY } from "@/lib/policy";
import { addToCart, getCart, removeFromCart } from "@/server/cart";

export interface ToolCall {
  tool: string;
  input: unknown;
  output: unknown;
}

// ------------------------------------------------------------------- catalog

export function search_catalog(query: string, limit = 5): Product[] {
  return searchCatalog(CATALOG, query, limit);
}

export function lookup_skus(ids: string[]): { found: Product[]; not_found: string[] } {
  const found = lookupSkusPure(CATALOG, ids);
  const foundIds = new Set(found.map((p) => p.id));
  return { found, not_found: ids.filter((id) => !foundIds.has(id)) };
}

// ---------------------------------------------------------------------- cart

export function add_to_cart(
  cartId: string,
  skuId: string,
  qty = 1,
  origin?: { campaign_id: string; gift?: boolean },
) {
  const lines = addToCart(cartId, skuId, qty, origin);
  // Gifts are in the bag but not in the price.
  return { lines, cart: priceCart(CATALOG, payable(lines)) };
}

/** Charged lines only. A gift is shipped, never billed. */
function payable(lines: Array<{ sku_id: string; qty: number; gift?: boolean }>) {
  return lines.filter((l) => l.gift !== true).map((l) => ({ sku_id: l.sku_id, qty: l.qty }));
}

export function remove_from_cart(cartId: string, skuId: string) {
  const lines = removeFromCart(cartId, skuId);
  return { lines, cart: priceCart(CATALOG, payable(lines)) };
}

export function get_cart(cartId: string) {
  const lines = getCart(cartId);
  return { lines, cart: priceCart(CATALOG, payable(lines)) };
}

// -------------------------------------------------------------------- upsell

export interface UpsellSuggestion {
  sku_id: string;
  title: string;
  price_paise: number;
  reason: string;
}

/**
 * At most two suggestions, drawn only from the catalog's own upgrades and
 * complements, and only if they keep the cart inside the order cap and at or
 * above the margin floor.
 *
 * The reason text may mention that a bigger basket could reach a higher rung.
 * It is careful to say "may" — the kernel decides, and it can still clamp.
 */
export function suggest_upsell(cartId: string): UpsellSuggestion[] {
  const lines = getCart(cartId);
  if (lines.length === 0) return [];

  const current = priceCart(CATALOG, lines);
  const candidates = recommendationCandidates(CATALOG, lines);
  const out: UpsellSuggestion[] = [];

  for (const c of candidates) {
    if (out.length >= 2) break;

    const projected = priceCart(CATALOG, [...lines, { sku_id: c.id, qty: 1 }]);

    // Never suggest something that would push the cart past the cap.
    if (projected.amount_paise > DEV_POLICY.max_order_paise) continue;

    // Never suggest something that drags cart margin below the floor.
    if (projected.margin_bps < DEV_POLICY.margin_floor_bps) continue;

    const headroomNow = current.margin_bps - DEV_POLICY.margin_floor_bps;
    const headroomAfter = projected.margin_bps - DEV_POLICY.margin_floor_bps;

    const bestRungNow = highestRungWithin(headroomNow);
    const bestRungAfter = highestRungWithin(headroomAfter);

    const reason =
      bestRungAfter > bestRungNow
        ? `Adding this raises cart margin to ${projected.margin_bps} bps, which may unlock the ${bestRungAfter / 100}% rung — the kernel still decides and may clamp lower.`
        : `Pairs with what is in the cart. Margin stays at ${projected.margin_bps} bps, above the ${DEV_POLICY.margin_floor_bps} bps floor.`;

    out.push({ sku_id: c.id, title: c.title, price_paise: c.price_paise, reason });
  }

  return out;
}

/** Highest ladder rung whose discount fits inside the given margin headroom. */
function highestRungWithin(headroomBps: number): number {
  let best = 0;
  for (const rung of DEV_POLICY.ladder) {
    if (rung.discount_bps <= headroomBps && rung.discount_bps > best) best = rung.discount_bps;
  }
  return best;
}

// ------------------------------------------------------------------ campaign

export function apply_campaign(cartId: string, now = new Date()) {
  const lines = getCart(cartId);
  const cart = priceCart(CATALOG, lines);
  const live: Campaign[] = CAMPAIGNS.map((c) => ({ ...c, active: isCampaignActive(c.id) }));
  return pick(live, CATALOG, cart, now);
}

export function list_campaigns(now = new Date()) {
  return CAMPAIGNS.map((c) => ({
    ...c,
    active: isCampaignActive(c.id),
    in_window:
      Date.parse(c.window_start) <= now.getTime() && now.getTime() <= Date.parse(c.window_end),
  }));
}

// ------------------------------------------------------------------- propose

export interface ProposeToolInput {
  cart_id: string;
  requested_discount_bps: number;
  requested_offer_id?: string | null;
  /** What the agent said out loud, if it quoted a total. Compared, then dropped. */
  quoted_amount_paise?: number | null;
  free_text?: string | null;
  claimed_attributes?: Record<string, Record<string, string>>;
  campaign_id?: string | null;
  /** Without this the propose route answers 402. */
  mandate_hash?: string | null;
}

/**
 * The only route to money, and it is an HTTP call to the same endpoint an
 * outside bot uses. No shortcut, no shared process state, no Razorpay client.
 */
export async function propose_money_action(input: ProposeToolInput): Promise<{
  status: number;
  body: unknown;
}> {
  const lines = getCart(input.cart_id);

  const res = await fetch(`${baseUrl()}/api/checkout/propose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cart_id: input.cart_id,
      lines,
      currency: "INR",
      requested_discount_bps: input.requested_discount_bps,
      requested_offer_id: input.requested_offer_id ?? null,
      quoted_amount_paise: input.quoted_amount_paise ?? null,
      free_text: input.free_text ?? null,
      claimed_attributes: input.claimed_attributes ?? {},
      campaign_id: input.campaign_id ?? null,
      mandate_hash: input.mandate_hash ?? null,
    }),
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = text;
  }

  return { status: res.status, body };
}

const STOPWORDS = new Set(["the", "a", "an", "my", "to", "cart", "please", "some", "and"]);

/**
 * Resolve a spoken product name to a real SKU.
 *
 * A near-match is not good enough. "the totally fake unicorn cream" shares the
 * word "cream" with a real eye cream, and quietly substituting it would be the
 * agent inventing a purchase on the shopper's behalf — a hallucination that
 * looks like helpfulness. We require most of the meaningful words to land on
 * the same product, and return null otherwise.
 */
export function resolveSku(nameOrId: string): Product | null {
  const direct = productById(CATALOG, nameOrId);
  if (direct !== null) return direct;

  const terms = nameOrId
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9%]/g, ""))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

  if (terms.length === 0) return null;

  const candidate = searchCatalog(CATALOG, nameOrId, 1)[0];
  if (candidate === undefined) return null;

  const haystack = [
    candidate.title,
    candidate.description,
    candidate.category.join(" "),
    Object.values(candidate.attributes).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  const matched = terms.filter((t) => haystack.includes(t)).length;
  return matched / terms.length >= 0.6 ? candidate : null;
}
