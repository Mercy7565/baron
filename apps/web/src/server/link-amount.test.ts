import { describe, expect, it } from "vitest";

import { OFFER_LADDER } from "@countersign/contracts";
import { couponDiscountPaise } from "@countersign/kernel";

import { planPaymentLink } from "./link-amount";

/**
 * The Payment Link must capture exactly what the kernel decided.
 *
 * This is the arithmetic behind a real bug: the link was raised for the
 * already-discounted total with no offer named, Razorpay attached every ladder
 * offer whose minimum cart that total cleared, applied the largest at capture,
 * and the store billed a second discount it had never agreed to. A basket
 * settled at 20% off was captured at a further 15% off.
 *
 * So the property under test is not "the amount looks right" but the only thing
 * that matters: whatever branch is taken, the captured figure equals
 * legal_total_paise.
 */

/** A quote priced the way the kernel prices one, for a given rung. */
function quoteFor(subtotal: number, rung: (typeof OFFER_LADDER)[number]) {
  const discount = couponDiscountPaise(rung, subtotal);
  return {
    subtotal_paise: subtotal,
    legal_total_paise: subtotal - discount,
    applied_bps: rung.discount_bps,
    offer_id: rung.offer_id,
  };
}

describe("what a payment link is raised for", () => {
  it("captures the kernel's total for every rung at every plausible basket", () => {
    for (const rung of OFFER_LADDER) {
      for (const subtotal of [
        rung.min_cart_paise,
        rung.min_cart_paise + 1,
        249_00,
        1_599_00,
        4_999_00,
        // Deliberately past the point where each rung's rupee cap starts to
        // bind, which is the case a percentage offer cannot reproduce.
        50_000_00,
      ]) {
        if (subtotal < rung.min_cart_paise) continue;
        const quote = quoteFor(subtotal, rung);
        const plan = planPaymentLink(quote);

        expect(plan.expected_capture_paise).toBe(quote.legal_total_paise);
      }
    }
  });

  it("carries the pre-coupon basket and pins one rung when the percentage is exact", () => {
    // Rs 1698 at 11%: 169800 * 0.11 = 18678 exactly, under the Rs 800 cap.
    const rung = OFFER_LADDER.find((r) => r.discount_bps === 1100);
    expect(rung).toBeDefined();
    if (rung === undefined) return;

    const quote = quoteFor(169_800, rung);
    const plan = planPaymentLink(quote);

    expect(plan.amount_paise).toBe(169_800);
    expect(plan.offer_ids).toEqual([rung.offer_id]);
    expect(plan.expected_capture_paise).toBe(quote.legal_total_paise);
    expect(plan.shows_struck_original).toBe(true);
  });

  it("never shrinks the amount and attaches an offer at the same time", () => {
    // The one combination that is always wrong: a discounted amount plus an
    // offer is the double discount, restated.
    for (const rung of OFFER_LADDER) {
      for (const subtotal of [rung.min_cart_paise, 10_000_00, 50_000_00]) {
        if (subtotal < rung.min_cart_paise) continue;
        const quote = quoteFor(subtotal, rung);
        const plan = planPaymentLink(quote);

        if (plan.offer_ids.length > 0) {
          expect(plan.amount_paise).toBe(quote.subtotal_paise);
        }
      }
    }
  });

  it("pins nothing, and says so, when the rung's rupee cap binds", () => {
    // Rs 50,000 at 25% would be Rs 12,500 off, but the rung caps at Rs 1,500.
    // No percentage offer can reproduce that, so none is attached.
    const rung = OFFER_LADDER.find((r) => r.discount_bps === 2500);
    expect(rung).toBeDefined();
    if (rung === undefined) return;

    const quote = quoteFor(50_000_00, rung);
    const plan = planPaymentLink(quote);

    expect(plan.offer_ids).toEqual([]);
    expect(plan.amount_paise).toBe(quote.legal_total_paise);
    expect(plan.expected_capture_paise).toBe(quote.legal_total_paise);
  });

  it("pins nothing when no coupon was granted", () => {
    // An empty forced list is not the same as sending no options at all: it is
    // what stops Razorpay applying an offer nobody chose.
    const plan = planPaymentLink({
      subtotal_paise: 120_000,
      legal_total_paise: 120_000,
      applied_bps: 0,
      offer_id: null,
    });

    expect(plan.amount_paise).toBe(120_000);
    expect(plan.offer_ids).toEqual([]);
    expect(plan.expected_capture_paise).toBe(120_000);
  });
});
