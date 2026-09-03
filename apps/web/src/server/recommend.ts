import { productById, type Product } from "@countersign/catalog";

import { CATALOG } from "@/lib/catalog";
import { DEV_POLICY } from "@/lib/policy";
import { couponFor, couponIfAdded, type CouponOutcome } from "@/server/coupons";

/**
 * Ranked cross-sell that tells the truth.
 *
 * Two rules, both load-bearing:
 *
 *   1. Candidates come only from the catalog's own curated edges — frequently
 *      bought with, complements, upgrades. The recommender cannot name a SKU
 *      that is not already related to something in the basket.
 *
 *   2. Every number it speaks is computed by running the real kernel over the
 *      real basket, before and after the add. It used to estimate the rung from
 *      margin headroom, which could name a percentage the kernel would then
 *      refuse — "you'll get 15%" followed by a 5% link is a lie the shopper
 *      only discovers after paying.
 *
 * A suggestion has to earn its place: either the coupon that actually applies
 * gets better, or a live campaign with budget left is trying to move that
 * stock. Anything else is not a recommendation, it is an upsell wearing one.
 */

export interface Suggestion {
  sku_id: string;
  title: string;
  price_paise: number;
  image: string;
  /** Extra discount, in bps, that the kernel would actually allow. */
  extra_bps: number;
  /** What that is worth in rupees on the resulting basket. */
  extra_paise: number;
  legal_bps_after: number;
  /** The coupon the kernel would pick after the add. */
  offer_id_after: string | null;
  subtotal_after_paise: number;
  total_after_paise: number;
  campaign_id: string | null;
  campaign_name: string | null;
  /** Why this is here: a better coupon, or campaign stock being moved. */
  basis: "better_coupon" | "campaign_stock";
  /** One sentence a shopper can act on, with real numbers in it. */
  reason: string;
}

const rupees = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;

/** Curated edges only. Order is stable so the same cart ranks the same way. */
function candidates(lines: Array<{ sku_id: string; qty: number }>): Product[] {
  const inCart = new Set(lines.map((l) => l.sku_id));
  const seen = new Set<string>();
  const out: Product[] = [];

  for (const line of lines) {
    const p = productById(CATALOG, line.sku_id);
    if (p === null) continue;

    for (const id of [...p.upgrades, ...p.complements, ...(p.frequently_bought_with ?? [])]) {
      if (inCart.has(id) || seen.has(id)) continue;
      const rec = productById(CATALOG, id);
      // Never OOS, never blocked, never invented.
      if (rec === null || rec.blocked || rec.availability !== "in_stock" || rec.stock_qty <= 0) {
        continue;
      }
      seen.add(id);
      out.push(rec);
    }
  }
  return out;
}

/** True when a live campaign with budget left is trying to move this SKU. */
function campaignWantsToMove(after: CouponOutcome, skuId: string): boolean {
  const c = after.campaign;
  if (c === null || after.campaign_affordable_bps <= 0) return false;

  const t = c.target;
  if (t.kind === "sku") return t.sku_ids.includes(skuId);
  if (t.kind === "category") {
    const p = productById(CATALOG, skuId);
    return p !== null && p.category.includes(t.category);
  }
  return false;
}

export function recommend(
  lines: Array<{ sku_id: string; qty: number }>,
  now = new Date(),
  limit = 3,
): Suggestion[] {
  if (lines.length === 0) return [];

  const before = couponFor(lines, now);
  const scored: Suggestion[] = [];

  for (const candidate of candidates(lines)) {
    const after = couponIfAdded(lines, candidate.id, now);

    // Never suggest something that breaks the cap or the floor.
    if (after.subtotal_paise > DEV_POLICY.max_order_paise) continue;

    const betterCoupon = after.applied_bps > before.applied_bps;
    const movesStock = campaignWantsToMove(after, candidate.id);
    if (!betterCoupon && !movesStock) continue;

    const extraBps = Math.max(0, after.applied_bps - before.applied_bps);

    // The honest sentence. It names the basket the shopper would end up with
    // and the coupon that would actually be applied to it — not a percentage
    // we hope for.
    const reason = betterCoupon
      ? `Add the ${candidate.title.toLowerCase()} — cart becomes ${rupees(after.subtotal_paise)} and ${after.applied_bps / 100}% is actually allowed.`
      : `Add the ${candidate.title.toLowerCase()} — ${after.campaign?.name ?? "a live campaign"} still has budget for it. The coupon stays at ${after.applied_bps / 100}%.`;

    scored.push({
      sku_id: candidate.id,
      title: candidate.title,
      price_paise: candidate.price_paise,
      image: candidate.image,
      extra_bps: extraBps,
      // Real rupees: what they save after, minus what they save now.
      extra_paise: Math.max(0, after.discount_paise - before.discount_paise),
      legal_bps_after: after.applied_bps,
      offer_id_after: after.offer_id,
      subtotal_after_paise: after.subtotal_paise,
      total_after_paise: after.total_paise,
      campaign_id: after.campaign?.id ?? null,
      campaign_name: after.campaign?.name ?? null,
      basis: betterCoupon ? "better_coupon" : "campaign_stock",
      reason,
    });
  }

  // A better coupon outranks stock-moving; then the size of the gain; then id,
  // so the same cart always ranks the same way.
  scored.sort((a, b) => {
    if (a.basis !== b.basis) return a.basis === "better_coupon" ? -1 : 1;
    if (b.extra_bps !== a.extra_bps) return b.extra_bps - a.extra_bps;
    return a.sku_id < b.sku_id ? -1 : 1;
  });

  return scored.slice(0, limit);
}
