import { describe, expect, it } from "vitest";

import { addLine, payable, removeLine, type BasketLine } from "./cart";
import { cartFingerprint } from "./fingerprint";

const empty: BasketLine[] = [];

/**
 * A gift is shipped, never billed.
 *
 * A buy-one-get-one campaign hands over a product without touching the amount:
 * the seven Razorpay coupons are the only thing that ever reduces a total, so a
 * free item is simply absent from the money path rather than a discount nobody
 * can trace to a coupon id.
 */
describe("gift lines", () => {
  it("is in the bag but not in the price", () => {
    let bag = addLine(empty, "sku_lipbalm_spf_10", 1);
    bag = addLine(bag, "sku_kit_starter", 1, { campaign_id: "cmp_test", gift: true });

    expect(bag).toHaveLength(2);
    expect(payable(bag)).toEqual([{ sku_id: "sku_lipbalm_spf_10", qty: 1 }]);
  });

  it("carries the campaign that gave it away", () => {
    const bag = addLine(empty, "sku_kit_starter", 1, { campaign_id: "cmp_test", gift: true });
    const line = bag[0];

    expect(line?.gift).toBe(true);
    expect(line?.from_campaign_id).toBe("cmp_test");
  });

  it("records the campaign on an accepted paid suggestion too", () => {
    const bag = addLine(empty, "sku_cleanser_gel_100", 1, { campaign_id: "cmp_paid" });
    const line = bag[0];

    expect(line?.gift).toBeUndefined();
    expect(line?.from_campaign_id).toBe("cmp_paid");
    expect(payable(bag)).toEqual([{ sku_id: "sku_cleanser_gel_100", qty: 1 }]);
  });

  it("never merges with a bought copy of the same product", () => {
    // Merging would either charge for the gift or give away the paid one.
    let bag = addLine(empty, "sku_kit_starter", 1);
    bag = addLine(bag, "sku_kit_starter", 1, { campaign_id: "cmp_test", gift: true });

    expect(bag).toHaveLength(2);
    expect(payable(bag)).toEqual([{ sku_id: "sku_kit_starter", qty: 1 }]);
  });

  it("does not move the cart fingerprint", () => {
    const bag = addLine(empty, "sku_lipbalm_spf_10", 1);
    const before = cartFingerprint(payable(bag));

    const withGift = addLine(bag, "sku_kit_starter", 1, { campaign_id: "cmp_test", gift: true });
    expect(cartFingerprint(payable(withGift))).toBe(before);
  });

  it("leaves the money path empty when only a gift remains", () => {
    let bag = addLine(empty, "sku_lipbalm_spf_10", 1);
    bag = addLine(bag, "sku_kit_starter", 1, { campaign_id: "cmp_test", gift: true });
    bag = removeLine(bag, "sku_lipbalm_spf_10");

    expect(payable(bag)).toEqual([]);
  });
});

/**
 * The basket operations are pure.
 *
 * They used to mutate a process-wide Map keyed by one shared id, which on a
 * serverless host meant every shopper edited the same bag and every instance
 * had its own copy of it. Taking the lines in and handing new lines back is
 * what lets the caller decide where a basket lives — which is now the
 * shopper's own cookie.
 */
describe("basket operations", () => {
  it("never mutates the array it was given", () => {
    const original: BasketLine[] = [{ sku_id: "sku_lipbalm_spf_10", qty: 1 }];
    const snapshot = JSON.stringify(original);

    addLine(original, "sku_lipbalm_spf_10", 3);
    addLine(original, "sku_kit_starter", 1);
    removeLine(original, "sku_lipbalm_spf_10");

    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("adds quantity to a line that is already there", () => {
    let bag = addLine(empty, "sku_lipbalm_spf_10", 1);
    bag = addLine(bag, "sku_lipbalm_spf_10", 2);

    expect(bag).toHaveLength(1);
    expect(bag[0]?.qty).toBe(3);
  });

  it("drops a line whose quantity reaches zero", () => {
    // The basket's minus button is an add of -1, so this is the normal path
    // for removing the last one rather than an edge case.
    let bag = addLine(empty, "sku_lipbalm_spf_10", 1);
    bag = addLine(bag, "sku_lipbalm_spf_10", -1);

    expect(bag).toEqual([]);
  });

  it("caps quantity and line count rather than trusting the caller", () => {
    let bag = addLine(empty, "sku_lipbalm_spf_10", 10_000);
    expect(bag[0]?.qty).toBe(99);

    for (let i = 0; i < 60; i += 1) bag = addLine(bag, `sku_made_up_${i}`, 1);
    expect(bag.length).toBeLessThanOrEqual(40);
  });
});
