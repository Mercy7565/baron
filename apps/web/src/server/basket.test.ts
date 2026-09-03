import { beforeEach, describe, expect, it } from "vitest";

import { addToCart, clearCart, getCart, payableLines, removeFromCart } from "./cart";
import { cartFingerprint } from "./fingerprint";

const BAG = "cart_test";

/**
 * A gift is shipped, never billed.
 *
 * A buy-one-get-one campaign hands over a product without touching the amount:
 * the seven Razorpay coupons are the only thing that ever reduces a total, so a
 * free item is simply absent from the money path rather than a discount nobody
 * can trace to a coupon id.
 */
describe("gift lines", () => {
  beforeEach(() => clearCart(BAG));

  it("is in the bag but not in the price", () => {
    addToCart(BAG, "sku_lipbalm_spf_10", 1);
    addToCart(BAG, "sku_kit_starter", 1, { campaign_id: "cmp_test", gift: true });

    expect(getCart(BAG)).toHaveLength(2);
    expect(payableLines(BAG)).toEqual([{ sku_id: "sku_lipbalm_spf_10", qty: 1 }]);
  });

  it("records the campaign that gave it", () => {
    addToCart(BAG, "sku_kit_starter", 1, { campaign_id: "cmp_test", gift: true });
    const line = getCart(BAG)[0];
    expect(line?.gift).toBe(true);
    expect(line?.from_campaign_id).toBe("cmp_test");
  });

  it("records the campaign behind an accepted paid suggestion too", () => {
    // Both spend the campaign's budget, so both have to carry its id.
    addToCart(BAG, "sku_cleanser_gel_100", 1, { campaign_id: "cmp_paid" });
    const line = getCart(BAG)[0];
    expect(line?.gift).toBeUndefined();
    expect(line?.from_campaign_id).toBe("cmp_paid");
    expect(payableLines(BAG)).toEqual([{ sku_id: "sku_cleanser_gel_100", qty: 1 }]);
  });

  it("does not merge a gift with a bought copy of the same product", () => {
    addToCart(BAG, "sku_kit_starter", 1);
    addToCart(BAG, "sku_kit_starter", 1, { campaign_id: "cmp_test", gift: true });

    expect(getCart(BAG)).toHaveLength(2);
    expect(payableLines(BAG)).toEqual([{ sku_id: "sku_kit_starter", qty: 1 }]);
  });

  it("keeps the fingerprint free of gifts, so a gift cannot move the price", () => {
    addToCart(BAG, "sku_lipbalm_spf_10", 1);
    const before = cartFingerprint(payableLines(BAG));

    addToCart(BAG, "sku_kit_starter", 1, { campaign_id: "cmp_test", gift: true });
    expect(cartFingerprint(payableLines(BAG))).toBe(before);
  });

  it("has nothing to charge when only a gift is left", () => {
    addToCart(BAG, "sku_lipbalm_spf_10", 1);
    addToCart(BAG, "sku_kit_starter", 1, { campaign_id: "cmp_test", gift: true });
    removeFromCart(BAG, "sku_lipbalm_spf_10");

    expect(payableLines(BAG)).toEqual([]);
  });
});

/**
 * A paid bag stops being a bag. Returning to /cart after paying and finding the
 * basket still there is the shortest path to buying the same thing twice.
 */
describe("clearing a paid bag", () => {
  beforeEach(() => clearCart(BAG));

  it("empties it", () => {
    addToCart(BAG, "sku_lipbalm_spf_10", 2);
    clearCart(BAG);
    expect(getCart(BAG)).toEqual([]);
  });

  it("only touches the bag it is told to", () => {
    addToCart(BAG, "sku_lipbalm_spf_10", 1);
    addToCart("cart_other", "sku_kit_starter", 1);

    clearCart(BAG);
    expect(getCart("cart_other")).toHaveLength(1);
    clearCart("cart_other");
  });
});
