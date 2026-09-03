import { describe, expect, it } from "vitest";

import { cartFingerprint } from "./fingerprint";

/**
 * M1 in code.
 *
 * A price and a Payment Link belong to one exact basket. This is the identity
 * that binds them; when it was missing, "issue a link for the newest quote"
 * happily billed a different bag, and a ₹3,096 cart opened a ₹2,292 link.
 */
describe("cart fingerprint", () => {
  it("is the same basket regardless of the order lines arrive in", () => {
    expect(cartFingerprint([{ sku_id: "b", qty: 1 }, { sku_id: "a", qty: 2 }])).toBe(
      cartFingerprint([{ sku_id: "a", qty: 2 }, { sku_id: "b", qty: 1 }]),
    );
  });

  it("changes when a quantity changes", () => {
    expect(cartFingerprint([{ sku_id: "a", qty: 1 }])).not.toBe(
      cartFingerprint([{ sku_id: "a", qty: 2 }]),
    );
  });

  it("changes when a line is added or removed", () => {
    const one = cartFingerprint([{ sku_id: "a", qty: 1 }]);
    const two = cartFingerprint([{ sku_id: "a", qty: 1 }, { sku_id: "b", qty: 1 }]);
    expect(one).not.toBe(two);
    expect(cartFingerprint([{ sku_id: "b", qty: 1 }])).not.toBe(two);
  });

  it("ignores lines that are not really there", () => {
    expect(cartFingerprint([{ sku_id: "a", qty: 1 }, { sku_id: "b", qty: 0 }])).toBe(
      cartFingerprint([{ sku_id: "a", qty: 1 }]),
    );
  });

  it("is readable, so a log says what the basket was", () => {
    expect(cartFingerprint([{ sku_id: "sku_a", qty: 2 }])).toBe("sku_a:2");
  });
});

/**
 * The limits around the kernel must not become a second, invisible policy.
 * A demo mandate that capped discount at 15% quietly refused the 20% and 25%
 * coupons, and did it inconsistently enough that the on-screen total and the
 * Payment Link could disagree.
 */
describe("the guard rails sit at or above the store's own", () => {
  it("lets every coupon on the ladder through", async () => {
    const { mintDemoIntent } = await import("@countersign/mandates");
    const { DEV_POLICY } = await import("@/lib/policy");

    const intent = mintDemoIntent(new Date());
    const topCoupon = Math.max(...DEV_POLICY.ladder.map((r) => r.discount_bps));

    expect(intent.max_discount_bps).toBeGreaterThanOrEqual(topCoupon);
    expect(intent.max_amount_paise).toBeGreaterThanOrEqual(DEV_POLICY.max_order_paise);
  });

  it("does not send an ordinary skincare basket to a human", async () => {
    const { DEV_POLICY } = await import("@/lib/policy");
    // Four products is a normal routine, not an exception to escalate.
    expect(DEV_POLICY.escalate_above_paise ?? Infinity).toBeGreaterThan(400_000);
  });
});
