import { OFFER_LADDER } from "@countersign/contracts";
import { type Quote } from "@countersign/quotes";

/**
 * Which rows count as real.
 *
 * The ledger carries history from two retired coupon sets — `offer_TVG*` from
 * the first Razorpay account and `offer_PENDING_*` from the days before the
 * dashboard ids arrived. Those rows are genuine history and are not deleted,
 * but counting them in a KPI is misleading: they describe coupons that cannot
 * attach any more, on an account that may not exist.
 *
 * A row is live when the coupon it names is on the current ladder, or when it
 * names no coupon at all *and* was created after the current ladder shipped.
 * The second clause matters: plenty of old rows have `offer_id: null` because
 * a dead coupon was refused, and those should not be counted either.
 */

export const LIVE_OFFER_IDS: ReadonlySet<string> = new Set(
  OFFER_LADDER.map((r) => r.offer_id),
);

/**
 * When the current ladder shipped.
 *
 * A no-coupon row older than this belongs to the retired sets. Held as a
 * constant rather than derived, because the point is to name the cutover.
 */
export const LADDER_SHIPPED_AT = "2026-09-03T12:00:00.000Z";

/** True when this quote describes a coupon the store can still attach. */
export function isLiveQuote(q: Quote): boolean {
  if (q.offer_id !== null) return LIVE_OFFER_IDS.has(q.offer_id);
  return q.created_at >= LADDER_SHIPPED_AT;
}

/** True when this row names a coupon from a retired set. */
export function isRetiredQuote(q: Quote): boolean {
  return !isLiveQuote(q);
}
