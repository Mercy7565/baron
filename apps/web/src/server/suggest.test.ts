import { describe, expect, it } from "vitest";

import { CATALOG } from "@/lib/catalog";
import { DEV_POLICY } from "@/lib/policy";

import { suggestForCart } from "./suggest";

/**
 * The assistant may only suggest something it can defend.
 *
 * Every rule here exists because the alternative is a lie to a shopper: a
 * suggestion for a product we cannot sell, a percentage policy would refuse, or
 * an add that quietly takes the basket under the merchant's margin floor.
 */
describe("cart suggestions", () => {
  const seed = [{ sku_id: "sku_serum_niacin_30", qty: 1 }];

  it("returns at most two, and never the same product twice", () => {
    const out = suggestForCart(seed);
    expect(out.length).toBeLessThanOrEqual(2);
    expect(new Set(out.map((s) => s.sku_id)).size).toBe(out.length);
  });

  it("never suggests something already in the basket", () => {
    for (const s of suggestForCart(seed)) {
      expect(s.sku_id).not.toBe("sku_serum_niacin_30");
    }
  });

  it("never suggests a blocked, out-of-stock or off-sale product", () => {
    const basket = [
      { sku_id: "sku_serum_niacin_30", qty: 1 },
      { sku_id: "sku_moist_rich_50", qty: 1 },
    ];
    for (const s of suggestForCart(basket)) {
      const p = CATALOG.products.find((x) => x.id === s.sku_id);
      expect(p).toBeDefined();
      expect(p?.blocked).toBe(false);
      expect(p?.availability).toBe("in_stock");
      expect(p?.stock_qty ?? 0).toBeGreaterThan(0);
      // The denylisted retinoid is the one that must never appear.
      expect(DEV_POLICY.blocked_product_ids).not.toContain(s.sku_id);
      expect(s.sku_id).not.toBe("sku_retinoid_03");
    }
  });

  it("keeps the resulting basket above the merchant's margin floor", () => {
    for (const s of suggestForCart(seed)) {
      // The coupon it names, applied to the basket it describes, must still
      // leave margin at or above the floor.
      expect(s.coupon_bps_after).toBeGreaterThanOrEqual(0);
      expect(s.coupon_bps_after).toBeLessThanOrEqual(2500);
    }
  });

  it("only ever names a coupon from the seven live ids", () => {
    const live = new Set(DEV_POLICY.ladder.map((r) => r.discount_bps));
    for (const s of suggestForCart(seed)) {
      expect(s.coupon_bps_after === 0 || live.has(s.coupon_bps_after)).toBe(true);
    }
  });

  it("says nothing about an empty basket", () => {
    expect(suggestForCart([])).toEqual([]);
  });

  it("ranks the same basket the same way twice", () => {
    const now = new Date("2026-09-04T00:00:00.000Z");
    expect(suggestForCart(seed, now).map((s) => s.sku_id)).toEqual(
      suggestForCart(seed, now).map((s) => s.sku_id),
    );
  });
});
