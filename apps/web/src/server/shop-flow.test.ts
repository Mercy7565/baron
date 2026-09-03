import { describe, expect, it } from "vitest";

import { type Catalog, priceCart } from "@countersign/catalog";
import { evaluate } from "@countersign/kernel";

import catalogJson from "../data/catalog.json";
import { resolveSku } from "./tools";
import { recommend } from "./recommend";
import { couponFor, couponIfAdded } from "./coupons";
import { DEV_POLICY } from "../lib/policy";

const CATALOG = catalogJson as Catalog;

/**
 * The shopper-facing promises, held to at the level they are actually made:
 * a product that does not exist never becomes a link, and the answer to the
 * upsell question changes what the buyer pays.
 *
 * These deliberately stop short of Razorpay. Issuing a link is a network call
 * against a live test account; what is worth pinning here is that the decision
 * feeding it is different for accept and for reject, and that a hallucinated
 * SKU never reaches that decision at all.
 */
describe("a product that does not exist never becomes a link", () => {
  it("refuses to resolve an invented SKU", () => {
    for (const invented of [
      "totally fake unicorn cream",
      "unicorn tears serum",
      "dragonscale exfoliant",
    ]) {
      expect(resolveSku(invented)).toBeNull();
    }
  });

  it("does not substitute a near match that merely shares a word", () => {
    // "serum" is in several real titles. Sharing one word is not confidence.
    expect(resolveSku("unicorn serum")).toBeNull();
  });

  it("still resolves a real product, so the bar is not simply set to reject", () => {
    const hit = resolveSku("niacinamide");
    expect(hit).not.toBeNull();
    expect(hit?.id).toBe("sku_serum_niacin_30");
  });

  it("has no priceable cart, and therefore no total, for an invented SKU", () => {
    const hit = resolveSku("totally fake unicorn cream");
    expect(hit).toBeNull();
    // Nothing to price means nothing to charge: the flow ends before money.
    const lines = hit === null ? [] : [{ sku_id: hit.id, qty: 1 }];
    expect(lines).toHaveLength(0);
  });
});

describe("accept and reject produce different money", () => {
  const base = [{ sku_id: "sku_serum_niacin_30", qty: 1 }];

  function legalTotal(lines: Array<{ sku_id: string; qty: number }>): {
    total: number;
    applied: number;
  } {
    const cart = priceCart(CATALOG, lines);
    const decision = evaluate(
      {
        cart_id: "t",
        amount_paise: cart.amount_paise,
        currency: "INR",
        requested_discount_bps: 1500,
        requested_offer_id: null,
        product_ids: cart.product_ids,
        margin_bps: cart.margin_bps,
      },
      DEV_POLICY,
    );
    const total =
      cart.amount_paise -
      Math.floor((cart.amount_paise * decision.applied_discount_bps) / 10_000);
    return { total, applied: decision.applied_discount_bps };
  }

  it("offers something to accept in the first place", () => {
    expect(recommend(base).length).toBeGreaterThan(0);
  });

  it("charges more when the suggestion is accepted, because the basket is bigger", () => {
    const top = recommend(base)[0];
    expect(top).toBeDefined();

    const rejected = legalTotal(base);
    const accepted = legalTotal([...base, { sku_id: top!.sku_id, qty: 1 }]);

    expect(accepted.total).not.toBe(rejected.total);
    expect(accepted.total).toBeGreaterThan(rejected.total);
  });

  it("never grants more than the ladder's top rung on either path", () => {
    const top = recommend(base)[0];
    const rungs = DEV_POLICY.ladder.map((r) => r.discount_bps);
    const ceiling = Math.max(...rungs);

    for (const lines of [base, [...base, { sku_id: top!.sku_id, qty: 1 }]]) {
      const { applied } = legalTotal(lines);
      expect(applied).toBeLessThanOrEqual(ceiling);
      // Whatever is granted is a rung, never an interpolation between two.
      expect(applied === 0 || rungs.includes(applied)).toBe(true);
    }
  });
});

/**
 * The agent may not name a percentage the kernel would refuse.
 *
 * This is the promise that makes the upsell honest: whatever the suggestion
 * says is "actually allowed" has to survive a real evaluate() on the basket
 * that would result from taking it.
 */
describe("recommendations tell the truth about the coupon", () => {
  const seed = [{ sku_id: "sku_serum_niacin_30", qty: 1 }];

  it("every suggested percentage is one the kernel really allows", () => {
    for (const s of recommend(seed)) {
      const actual = couponIfAdded(seed, s.sku_id);
      expect(s.legal_bps_after).toBe(actual.applied_bps);
      expect(s.offer_id_after).toBe(actual.offer_id);
      expect(s.subtotal_after_paise).toBe(actual.subtotal_paise);
      expect(s.total_after_paise).toBe(actual.total_paise);
    }
  });

  it("never claims a gain the kernel would not grant", () => {
    const before = couponFor(seed);
    for (const s of recommend(seed)) {
      expect(s.legal_bps_after).toBeGreaterThanOrEqual(before.applied_bps);
      expect(s.extra_bps).toBe(Math.max(0, s.legal_bps_after - before.applied_bps));
      // The rupee figure is real money off, not a percentage dressed up.
      const actual = couponIfAdded(seed, s.sku_id);
      expect(s.extra_paise).toBe(Math.max(0, actual.discount_paise - before.discount_paise));
    }
  });

  it("only suggests a better coupon or live campaign stock, never filler", () => {
    const before = couponFor(seed);
    for (const s of recommend(seed)) {
      const better = s.legal_bps_after > before.applied_bps;
      const campaign = s.campaign_id !== null;
      expect(better || campaign).toBe(true);
      expect(s.basis).toBe(better ? "better_coupon" : "campaign_stock");
    }
  });

  it("the sentence it speaks carries the real resulting cart", () => {
    for (const s of recommend(seed)) {
      if (s.basis !== "better_coupon") continue;
      const rupees = `₹${(s.subtotal_after_paise / 100).toFixed(2)}`;
      expect(s.reason).toContain(rupees);
      expect(s.reason).toContain(`${s.legal_bps_after / 100}% is actually allowed`);
    }
  });
});
