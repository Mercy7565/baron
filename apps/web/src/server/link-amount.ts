/**
 * What a Payment Link is raised for, and which offer is pinned to it.
 *
 * Pure and separate from the checkout route so it can be tested against the
 * whole ladder without touching Razorpay. Every path through it has to satisfy
 * one invariant, and it is the only invariant that matters here:
 *
 *     captured paise === legal_total_paise
 *
 * Left to itself Razorpay attaches every offer whose minimum cart the link
 * amount clears and applies the largest of them at capture. A link raised for
 * an already-discounted total therefore got discounted a second time — a
 * basket the kernel settled at 20% off was captured at a further 15% off, and
 * the store billed less than it had decided to. Naming the offer explicitly,
 * with force_offer, is what makes the captured figure predictable.
 */

export interface LinkPlan {
  /** What the Payment Link is raised for. */
  amount_paise: number;
  /** Offers pinned to the link's order. Empty is meaningful, not a no-op. */
  offer_ids: string[];
  /** What Razorpay will actually capture, for the caller to assert on. */
  expected_capture_paise: number;
  /** True when the shopper sees the pre-coupon price struck through. */
  shows_struck_original: boolean;
}

/**
 * Decide the plan for one quote.
 *
 * Two branches, both landing on `legal_total_paise`:
 *
 *   1. The kernel granted a rung whose plain percentage reproduces its own
 *      arithmetic exactly. The link carries the pre-coupon subtotal and pins
 *      that one rung, so Razorpay strikes the original and charges the rest.
 *
 *   2. Otherwise the link carries the settled total and pins nothing — with
 *      force_offer still set, because an empty forced list is what stops
 *      Razorpay helping itself to an offer nobody chose.
 *
 * The second branch exists because a ladder rung also carries a rupee cap.
 * When that cap binds, the kernel's discount is smaller than the flat
 * percentage and no percentage offer can reproduce it, so we do not pretend
 * one can. Shrinking the amount *and* attaching an offer is the one
 * combination that is never correct, and it is unreachable from here.
 */
export function planPaymentLink(quote: {
  subtotal_paise: number;
  legal_total_paise: number;
  applied_bps: number;
  offer_id: string | null;
}): LinkPlan {
  const kernelDiscount = quote.subtotal_paise - quote.legal_total_paise;
  const flatPercent = Math.floor((quote.subtotal_paise * quote.applied_bps) / 10_000);

  const reproducible =
    quote.applied_bps > 0 &&
    quote.offer_id !== null &&
    kernelDiscount > 0 &&
    kernelDiscount === flatPercent;

  if (reproducible && quote.offer_id !== null) {
    return {
      amount_paise: quote.subtotal_paise,
      offer_ids: [quote.offer_id],
      expected_capture_paise: quote.subtotal_paise - flatPercent,
      shows_struck_original: true,
    };
  }

  return {
    amount_paise: quote.legal_total_paise,
    offer_ids: [],
    expected_capture_paise: quote.legal_total_paise,
    shows_struck_original: false,
  };
}
