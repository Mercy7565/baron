import { OFFER_LADDER, type Policy } from "@countersign/contracts";

import { marginFloorBps } from "@/server/overlay";

/**
 * The margin floor the store ships with: 15%.
 *
 * It used to be 48%, which was the real reason the product felt broken.
 * Catalog margins run 32–56%, so a 48% floor left a typical basket a few
 * hundred basis points of headroom and almost every cart cleared 2% and no
 * more — the seven-coupon ladder existed but only its bottom rung was ever
 * reachable, and every decision read as a clamp. At 15% the ladder can
 * actually be climbed, and the floor still does its job: it is a floor, not a
 * decoration.
 */
export const DEFAULT_MARGIN_FLOOR_BPS = 1500;

const BASE: Policy = {
  policy_version: "v0.1.0",
  /**
   * ₹50,000. The old ₹5,000 cap refused baskets a real shopper could easily
   * build, and a refused basket is not a safety feature when the amount is
   * ordinary.
   */
  max_order_paise: 5_000_000,
  /**
   * ₹50,000 and above needs a human.
   *
   * This was ₹3,000, which is an ordinary skincare basket — four products hit
   * it. Every such bag came back ESCALATE, which blanked the coupon and told a
   * shopper "a human must decide" about their own routine. Escalation is for
   * amounts that are unusual for this store, not for a normal checkout.
   */
  escalate_above_paise: 5_000_000,
  margin_floor_bps: DEFAULT_MARGIN_FLOOR_BPS,
  blocked_product_ids: ["sku_blocked"],
  ladder: [...OFFER_LADDER],
};

/**
 * The policy as the store currently enforces it.
 *
 * Read through a getter, like the catalog, so a merchant moving the margin
 * floor in the console takes effect on the very next quote without a restart.
 * Every consumer already treats this as a plain object and passes it to the
 * kernel, so nothing else had to change.
 */
export const DEV_POLICY: Policy = new Proxy(BASE, {
  get(target, prop, receiver) {
    if (prop === "margin_floor_bps") return marginFloorBps(target.margin_floor_bps);
    return Reflect.get(target, prop, receiver);
  },
});
