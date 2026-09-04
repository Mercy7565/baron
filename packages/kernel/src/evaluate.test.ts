import { describe, expect, it } from "vitest";

import {
  couponDiscountPaise,
  evaluate,
  type Policy,
  type ProposedMoneyAction,
} from "./index";

/**
 * The coupon ladder, declared here rather than imported from
 * @countersign/contracts so the kernel's tests stay as dependency-free as the
 * kernel itself. Same seven rungs, same minimums and caps.
 */
const LADDER = [
  { discount_bps: 200, offer_id: "offer_TXuWY6xddeXxVe", min_cart_paise: 10_000, max_discount_paise: 15_000 },
  { discount_bps: 500, offer_id: "offer_TXuXqoGAWqOZHA", min_cart_paise: 50_000, max_discount_paise: 40_000 },
  { discount_bps: 700, offer_id: "offer_TXuZNylUfodChM", min_cart_paise: 80_000, max_discount_paise: 50_000 },
  { discount_bps: 1100, offer_id: "offer_TXuanzMIxTBH9p", min_cart_paise: 120_000, max_discount_paise: 80_000 },
  { discount_bps: 1500, offer_id: "offer_TXuc8SQ7e1mTBO", min_cart_paise: 180_000, max_discount_paise: 100_000 },
  { discount_bps: 2000, offer_id: "offer_TXudQjjRCRnoXQ", min_cart_paise: 250_000, max_discount_paise: 120_000 },
  { discount_bps: 2500, offer_id: "offer_TXueiFQ59z3ARk", min_cart_paise: 350_000, max_discount_paise: 150_000 },
];

const LADDER_IDS = LADDER.map((r) => r.offer_id);

const policy = (over: Partial<Policy> = {}): Policy => ({
  policy_version: "v0.1.0",
  max_order_paise: 5_000_00,
  escalate_above_paise: null,
  margin_floor_bps: 1000,
  blocked_product_ids: ["sku_blocked"],
  ladder: LADDER,
  ...over,
});

const proposal = (over: Partial<ProposedMoneyAction> = {}): ProposedMoneyAction => ({
  cart_id: "cart_1",
  amount_paise: 50_000,
  currency: "INR",
  requested_discount_bps: 0,
  requested_offer_id: null,
  product_ids: ["sku_ok"],
  margin_bps: 3000,
  ...over,
});

describe("evaluate — allow", () => {
  it("allows a clean order with no discount requested", () => {
    const d = evaluate(proposal(), policy());

    expect(d.verdict).toBe("ALLOW");
    expect(d.applied_discount_bps).toBe(0);
    expect(d.offer_ids).toEqual([]);
    expect(d.force_offer).toBe(false);
    expect(d.policy_version).toBe("v0.1.0");
  });

  it("allows an exact rung and returns its offer id in Razorpay wire shape", () => {
    const d = evaluate(proposal({ requested_discount_bps: 500 }), policy());

    expect(d.verdict).toBe("ALLOW");
    expect(d.applied_discount_bps).toBe(500);
    // Bare id strings + force_offer — the object form is a silent no-op.
    expect(d.offer_ids).toEqual(["offer_TXuXqoGAWqOZHA"]);
    expect(d.force_offer).toBe(true);
  });
});

describe("evaluate — clamp", () => {
  it("clamps 15% down to the highest rung the margin floor allows", () => {
    // Margin 15%, floor 10% => at most 500 bps may be given away.
    const d = evaluate(
      proposal({ requested_discount_bps: 1500, margin_bps: 1500 }),
      policy({ margin_floor_bps: 1000 }),
    );

    expect(d.verdict).toBe("CLAMP");
    expect(d.requested_discount_bps).toBe(1500);
    expect(d.applied_discount_bps).toBe(500);
    expect(d.offer_ids).toEqual(["offer_TXuXqoGAWqOZHA"]);
    expect(d.force_offer).toBe(true);
    expect(d.reasons.code).toBe("clamp_to_rung");
  });

  it("clamps a between-rungs request down, never up", () => {
    // Ask 9% on a 500-rupee cart. 7% is the nearest rung below the ask, but it
    // needs an 800-rupee cart, so the answer is 5% — down twice, never up.
    const d = evaluate(proposal({ requested_discount_bps: 900 }), policy());

    expect(d.verdict).toBe("CLAMP");
    expect(d.applied_discount_bps).toBe(500);
    expect(d.offer_ids).toEqual(["offer_TXuXqoGAWqOZHA"]);
  });

  it("clamps to zero when no rung survives the margin floor", () => {
    // Margin 10%, floor 10% => no room for any discount at all.
    const d = evaluate(
      proposal({ requested_discount_bps: 1500, margin_bps: 1000 }),
      policy({ margin_floor_bps: 1000 }),
    );

    expect(d.verdict).toBe("CLAMP");
    expect(d.applied_discount_bps).toBe(0);
    expect(d.offer_ids).toEqual([]);
    expect(d.force_offer).toBe(false);
    expect(d.reasons.code).toBe("clamp_to_zero");
  });
});

describe("evaluate — reject", () => {
  it("rejects an amount over the policy limit", () => {
    const d = evaluate(proposal({ amount_paise: 5_000_01 }), policy({ max_order_paise: 5_000_00 }));

    expect(d.verdict).toBe("REJECT");
    expect(d.offer_ids).toEqual([]);
    expect(d.reasons.code).toBe("amount_over_limit");
  });

  it("rejects a non-positive amount", () => {
    expect(evaluate(proposal({ amount_paise: 0 }), policy()).verdict).toBe("REJECT");
    expect(evaluate(proposal({ amount_paise: -1 }), policy()).verdict).toBe("REJECT");
  });

  it("rejects a blocked product", () => {
    const d = evaluate(proposal({ product_ids: ["sku_ok", "sku_blocked"] }), policy());

    expect(d.verdict).toBe("REJECT");
    expect(d.reasons.code).toBe("product_blocked");
  });

  it("rejects a blocked product even when a valid offer is requested", () => {
    const d = evaluate(
      proposal({
        product_ids: ["sku_blocked"],
        requested_offer_id: "offer_TXuXqoGAWqOZHA",
        requested_discount_bps: 500,
      }),
      policy(),
    );

    expect(d.verdict).toBe("REJECT");
    expect(d.reasons.code).toBe("product_blocked");
    expect(d.offer_ids).toEqual([]);
  });
});

describe("evaluate — injected input", () => {
  it("ignores an off-ladder offer id and clamps to a ladder rung instead", () => {
    // The attacker's own offer id, plus a 15% ask on a 15%-margin cart.
    const d = evaluate(
      proposal({
        requested_offer_id: "offer_ATTACKER123",
        requested_discount_bps: 1500,
        margin_bps: 1500,
      }),
      policy(),
    );

    expect(d.verdict).toBe("CLAMP");
    // Never the attacker's id; only the 5% rung the policy actually allows.
    expect(d.offer_ids).toEqual(["offer_TXuXqoGAWqOZHA"]);
    expect(d.applied_discount_bps).toBe(500);
    expect(d.ignored_inputs).toHaveLength(1);
    expect(d.ignored_inputs[0]).toContain("offer_ATTACKER123");
  });

  it("reports nothing ignored when the request is clean", () => {
    expect(evaluate(proposal({ requested_discount_bps: 500 }), policy()).ignored_inputs).toEqual(
      [],
    );
  });

  it("still refuses an over-limit amount carrying an injected offer id", () => {
    const d = evaluate(
      proposal({ amount_paise: 900_000, requested_offer_id: "offer_ATTACKER123" }),
      policy(),
    );

    expect(d.verdict).toBe("REJECT");
    expect(d.offer_ids).toEqual([]);
  });
});

describe("evaluate — invariants", () => {
  it("never returns an offer id that is not on the ladder", () => {
    const requests = [0, 1, 199, 200, 499, 500, 900, 1100, 1499, 1500, 9999, -5];
    const margins = [0, 1000, 1500, 3000, 9000];

    for (const requested_discount_bps of requests) {
      for (const margin_bps of margins) {
        const d = evaluate(proposal({ requested_discount_bps, margin_bps }), policy());
        for (const id of d.offer_ids) {
          expect(LADDER_IDS).toContain(id);
        }
      }
    }
  });

  it("never applies more discount than was requested", () => {
    for (const requested_discount_bps of [0, 199, 200, 700, 1499, 1500]) {
      const d = evaluate(
        proposal({ requested_discount_bps, margin_bps: 9000 }),
        policy({ margin_floor_bps: 0 }),
      );
      expect(d.applied_discount_bps).toBeLessThanOrEqual(requested_discount_bps);
    }
  });

  it("is deterministic — same inputs, identical decision", () => {
    const p = proposal({ requested_discount_bps: 1500, margin_bps: 1500 });
    expect(evaluate(p, policy())).toEqual(evaluate(p, policy()));
  });

  it("escalates large amounts without attaching an offer", () => {
    const d = evaluate(
      proposal({ amount_paise: 400_000, requested_discount_bps: 500 }),
      policy({ max_order_paise: 500_000, escalate_above_paise: 300_000 }),
    );

    expect(d.verdict).toBe("ESCALATE");
    expect(d.offer_ids).toEqual([]);
    expect(d.force_offer).toBe(false);
    expect(d.reasons.detail.candidate_offer_id).toBe("offer_TXuXqoGAWqOZHA");
  });
});

/**
 * The minimum-cart gate.
 *
 * A percentage is not a promise until the basket is big enough to earn it. The
 * gate is what stops an agent quoting 11% on a 749-rupee cart and then handing
 * over a link for a different number — the coupon it names has to be the coupon
 * that would actually apply.
 */
describe("coupon minimum cart", () => {
  // Margin high enough that the floor never binds, so these tests isolate the
  // cart-size gate rather than accidentally testing the floor.
  const roomy = () => policy({ margin_floor_bps: 0 });

  it("cannot pick 11% on a 749-rupee cart", () => {
    const d = evaluate(
      proposal({ amount_paise: 74_900, requested_discount_bps: 1100, margin_bps: 6000 }),
      roomy(),
    );

    expect(d.applied_discount_bps).not.toBe(1100);
    expect(d.offer_ids).not.toContain("offer_TXuanzMIxTBH9p");
    // 749 clears the 5% minimum of 500 but not the 7% minimum of 800.
    expect(d.applied_discount_bps).toBe(500);
    expect(d.offer_ids).toEqual(["offer_TXuXqoGAWqOZHA"]);
    expect(d.verdict).toBe("CLAMP");
  });

  it("refuses every rung whose minimum cart the basket misses", () => {
    const cases: Array<[number, number, string | undefined]> = [
      [9_900, 0, undefined],            // under even the 2% minimum
      [10_000, 200, "offer_TXuWY6xddeXxVe"],
      [49_900, 200, "offer_TXuWY6xddeXxVe"],
      [50_000, 500, "offer_TXuXqoGAWqOZHA"],
      [79_900, 500, "offer_TXuXqoGAWqOZHA"],
      [80_000, 700, "offer_TXuZNylUfodChM"],
      [119_900, 700, "offer_TXuZNylUfodChM"],
      [120_000, 1100, "offer_TXuanzMIxTBH9p"],
      [179_900, 1100, "offer_TXuanzMIxTBH9p"],
      [180_000, 1500, "offer_TXuc8SQ7e1mTBO"],
      [249_900, 1500, "offer_TXuc8SQ7e1mTBO"],
      [250_000, 2000, "offer_TXudQjjRCRnoXQ"],
      [349_900, 2000, "offer_TXudQjjRCRnoXQ"],
      [350_000, 2500, "offer_TXueiFQ59z3ARk"],
    ];

    for (const [amount, expectedBps, expectedId] of cases) {
      const d = evaluate(
        // Ask for the top of the ladder every time; the cart decides.
        proposal({ amount_paise: amount, requested_discount_bps: 2500, margin_bps: 9000 }),
        policy({ margin_floor_bps: 0, max_order_paise: 1_000_000 }),
      );
      expect([amount, d.applied_discount_bps]).toEqual([amount, expectedBps]);
      expect(d.offer_ids).toEqual(expectedId === undefined ? [] : [expectedId]);
    }
  });

  it("says how big the cart would have to be when nothing fits", () => {
    const d = evaluate(
      proposal({ amount_paise: 5_000, requested_discount_bps: 2500, margin_bps: 9000 }),
      roomy(),
    );

    expect(d.applied_discount_bps).toBe(0);
    expect(d.offer_ids).toEqual([]);
    expect(d.reasons.detail.smallest_min_cart_paise).toBe(10_000);
  });

  it("still lets the margin floor refuse a coupon the cart size allows", () => {
    // A 3,500-rupee cart clears every minimum, but a 22% margin cannot fund a
    // 25% coupon above an 18% floor. The top two rungs losing here is correct.
    const d = evaluate(
      proposal({ amount_paise: 350_000, requested_discount_bps: 2500, margin_bps: 2200 }),
      policy({ margin_floor_bps: 1800, max_order_paise: 1_000_000 }),
    );

    expect(d.applied_discount_bps).toBe(200);
    expect(d.offer_ids).toEqual(["offer_TXuWY6xddeXxVe"]);
    expect(d.verdict).toBe("CLAMP");
  });
});

describe("coupon rupee cap", () => {
  it("never gives away more than the coupon's cap, however big the cart", () => {
    // 25% of 10,000 rupees is 2,500 — the coupon caps it at 1,500.
    const rung = {
      discount_bps: 2500,
      offer_id: "offer_TXueiFQ59z3ARk",
      min_cart_paise: 350_000,
      max_discount_paise: 150_000,
    };

    expect(couponDiscountPaise(rung, 1_000_000)).toBe(150_000);
    // Below the cap the percentage governs, exactly.
    expect(couponDiscountPaise(rung, 400_000)).toBe(100_000);
    expect(couponDiscountPaise(rung, 350_000)).toBe(87_500);
  });

  it("reports the capped rupee figure on the decision", () => {
    const d = evaluate(
      proposal({ amount_paise: 400_000, requested_discount_bps: 2500, margin_bps: 9000 }),
      policy({ margin_floor_bps: 0, max_order_paise: 1_000_000 }),
    );

    expect(d.applied_discount_bps).toBe(2500);
    expect(d.reasons.detail.discount_paise).toBe(100_000);
    expect(d.reasons.detail.max_discount_paise).toBe(150_000);
  });
});
