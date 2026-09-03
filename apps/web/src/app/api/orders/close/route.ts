import { getOrder, markClosed } from "@countersign/orders";
import { cancelPaymentLink } from "@countersign/razorpay";

import { requireRole } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/orders/close  { order_id }
 *
 * The buyer walking away from a link they are not going to pay.
 *
 * We ask Razorpay to cancel it first, so the URL genuinely stops working. If
 * Razorpay refuses — already paid, already expired, already cancelled — the
 * link is closed on our side only, and the response says which of the two
 * happened. What this never does is mark anything paid: closing is the opposite
 * of paying, and only Razorpay's own `paid` status can flip an order.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireRole("customer");
  if (!auth.ok) return auth.response;

  let body: { order_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const orderId = body.order_id ?? "";
  if (orderId === "") return Response.json({ error: "order_id is required" }, { status: 400 });

  const order = getOrder(orderId);
  if (order === null) return Response.json({ error: "no such order" }, { status: 404 });

  // A buyer may only close their own link.
  if (order.buyer_user_id !== auth.session.email) {
    return Response.json({ error: "not your order" }, { status: 403 });
  }

  if (order.status === "paid") {
    return Response.json(
      { error: "that order is paid and cannot be closed", status: order.status },
      { status: 409 },
    );
  }

  if (order.status === "closed") {
    return Response.json({ order, already_closed: true, cancelled_at_razorpay: false });
  }

  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";

  let cancelled = false;
  let razorpayError: string | null = null;

  if (keyId !== "" && keySecret !== "") {
    const result = await cancelPaymentLink({ keyId, keySecret }, order.payment_link_id);
    cancelled = result.ok;
    if (!result.ok) razorpayError = result.error;
  } else {
    razorpayError = "Razorpay credentials are not configured";
  }

  const closed = markClosed(orderId, cancelled);
  if (closed === null) {
    return Response.json({ error: "order could not be closed", status: order.status }, { status: 409 });
  }

  return Response.json({
    order: closed,
    cancelled_at_razorpay: cancelled,
    // Reported, not hidden: a link we could not cancel is still dead to us, but
    // the merchant should know it may survive at Razorpay.
    razorpay_error: razorpayError,
  });
}
