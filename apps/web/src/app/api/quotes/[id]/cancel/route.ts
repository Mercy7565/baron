import { allOrders, markClosed } from "@countersign/orders";
import { cancelQuote, getQuote } from "@countersign/quotes";
import { cancelPaymentLink } from "@countersign/razorpay";

import { requireRole } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/quotes/:id/cancel
 *
 * The buyer walking away from a bag they are not going to pay for.
 *
 * The rule is simple and there is only one of it: a paid bag cannot be closed,
 * and everything else can. It used to refuse far more than that — a quote whose
 * status had moved to `link_issued`, or that carried a Payment Link, or whose
 * mandate had since expired, all came back "that quote cannot be cancelled" and
 * left the row stuck on the Unpaid tab with no way to clear it.
 *
 * When a Payment Link exists we ask Razorpay to cancel it too, so the URL stops
 * working. That request is best-effort: the test account has a lifetime link
 * quota and can answer 429, and a buyer must not be held to a bag because our
 * housekeeping call failed. Our record closes either way, and the response says
 * which of the two happened.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireRole("customer");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const quote = getQuote(id);
  if (quote === null) return Response.json({ error: "no such quote" }, { status: 404 });

  // A buyer may only close their own bag.
  if (quote.buyer_user_id !== auth.session.email && quote.buyer_user_id !== "demo") {
    return Response.json({ error: "not your quote" }, { status: 403 });
  }

  // Paid is the one lock. Checked against the order too, because that is where
  // a confirmed payment is recorded.
  const order = allOrders().find((o) => o.quote_id === id) ?? null;
  if (quote.payment_id !== null || order?.status === "paid") {
    return Response.json(
      { error: "that bag is paid and cannot be closed", status: "paid" },
      { status: 409 },
    );
  }

  // Best-effort at Razorpay. Never a reason to refuse the close.
  let cancelledAtRazorpay = false;
  let razorpayError: string | null = null;

  const linkId = quote.payment_link_id ?? order?.payment_link_id ?? null;
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";

  if (linkId !== null && linkId !== "" && keyId !== "" && keySecret !== "") {
    const result = await cancelPaymentLink({ keyId, keySecret }, linkId);
    cancelledAtRazorpay = result.ok;
    if (!result.ok) razorpayError = result.error;
  }

  const cancelled = cancelQuote(id);
  if (cancelled === null) {
    return Response.json(
      { error: "that bag could not be closed", status: quote.status },
      { status: 409 },
    );
  }

  // Close the order too, so the row leaves the buyer's Unpaid list and stops
  // counting as money on the way in for the merchant.
  if (order !== null && order.status === "awaiting_payment") {
    markClosed(order.order_id, cancelledAtRazorpay);
  }

  return Response.json({
    quote_id: cancelled.quote_id,
    status: cancelled.status,
    cancelled_at_razorpay: cancelledAtRazorpay,
    razorpay_error: razorpayError,
  });
}
