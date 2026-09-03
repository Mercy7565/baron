import { describe, expect, it } from "vitest";

import { priceCart } from "@countersign/catalog";
import { evaluate } from "@countersign/kernel";

import { CATALOG } from "@/lib/catalog";
import { DEFAULT_MARGIN_FLOOR_BPS, DEV_POLICY } from "@/lib/policy";

import { bestClearableBps } from "./coupons";

/**
 * The floor is the choke point, so it gets a test.
 *
 * At the old 48% every one of these baskets cleared 2% and no more: the seven
 * coupons existed but only the smallest was ever reachable. At 15% the ladder
 * can actually be climbed, and each of these baskets reaches a different rung —
 * which is the whole point of having seven.
 */
describe("the margin floor decides how far up the ladder a basket reaches", () => {
  const priceOf = (skus: string[]) =>
    priceCart(
      CATALOG,
      skus.map((sku_id) => ({ sku_id, qty: 1 })),
    );

  const decide = (skus: string[]) => {
    const cart = priceOf(skus);
    const ask = bestClearableBps(cart.amount_paise, cart.margin_bps);
    return {
      cart,
      ask,
      decision: evaluate(
        {
          cart_id: "proof",
          amount_paise: cart.amount_paise,
          currency: "INR",
          requested_discount_bps: ask,
          requested_offer_id: null,
          product_ids: cart.product_ids,
          margin_bps: cart.margin_bps,
        },
        DEV_POLICY,
      ),
    };
  };

  it("ships with a 15% floor, not 48%", () => {
    expect(DEFAULT_MARGIN_FLOOR_BPS).toBe(1500);
    expect(DEV_POLICY.margin_floor_bps).toBeLessThanOrEqual(1500);
  });

  it("gives each of the four reference baskets the coupon it has earned", () => {
    const cases: Array<[string[], number, string]> = [
      [["sku_spf_fluid_50"], 500, "offer_TXZFaRi7PFRQyz"],
      [["sku_serum_niacin_30"], 700, "offer_TXZHijNccBb2uo"],
      [["sku_serum_niacin_30", "sku_serum_vitc_30"], 1500, "offer_TXZLlwmKPCba4H"],
      [
        ["sku_serum_niacin_30", "sku_serum_vitc_30", "sku_moist_light_50"],
        2000,
        "offer_TXZNRbvkOLZbd1",
      ],
    ];

    for (const [skus, expectedBps, expectedOffer] of cases) {
      const { decision } = decide(skus);
      expect([skus.join("+"), decision.applied_discount_bps]).toEqual([
        skus.join("+"),
        expectedBps,
      ]);
      expect(decision.offer_ids).toEqual([expectedOffer]);
      // Asking for what the basket can clear means the answer agrees with the
      // question. A CLAMP here would mean the ask logic is wrong again.
      expect(decision.verdict).toBe("ALLOW");
    }
  });

  it("does not refuse the sunscreen basket", () => {
    const { decision } = decide(["sku_spf_fluid_50"]);
    expect(decision.verdict).not.toBe("REJECT");
    expect(decision.applied_discount_bps).toBeGreaterThan(0);
  });

  it("still refuses everything if the floor is raised above the catalog's margins", () => {
    // The floor is a real floor, not decoration: at 60% nothing can discount.
    const cart = priceOf(["sku_serum_niacin_30", "sku_serum_vitc_30"]);
    const decision = evaluate(
      {
        cart_id: "proof",
        amount_paise: cart.amount_paise,
        currency: "INR",
        requested_discount_bps: 2500,
        requested_offer_id: null,
        product_ids: cart.product_ids,
        margin_bps: cart.margin_bps,
      },
      { ...DEV_POLICY, margin_floor_bps: 6000 },
    );
    expect(decision.applied_discount_bps).toBe(0);
    expect(decision.offer_ids).toEqual([]);
  });
});
