import { allOrders, getOrder, markPaid, type Order } from "@countersign/orders";

import { DEMO_CART_ID, clearCart } from "@/server/cart";
import { burnForPaidOrder } from "@/server/burn";
import { fetchPaymentLink } from "@countersign/razorpay";

import { requireRole } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/orders/refresh
 *
 * Ask Razorpay whether the Payment Link was actually paid, and flip the order
 * only if it says so. There is no code path here that marks an order paid on
 * our own say-so — the payment id comes from Razorpay or the order stays
 * awaiting_payment.
 */
async function refresh(order: Order, creds: { keyId: string; keySecret: string }): Promise<Order> {
  if (order.status === "paid") return order;

  const result = await fetchPaymentLink(creds, order.payment_link_id);
  if (!result.ok) return order;

  const link = result.data;
  const paid = (link.payments ?? []).find(
    (p) => typeof p.payment_id === "string" && p.payment_id !== "",
  );

  // "paid" on the link plus a real payment id. Either alone is not enough.
  if (link.status !== "paid" || paid?.payment_id === undefined) return order;

  const flipped = markPaid(order.order_id, paid.payment_id);
  if (flipped === null) return order;

  /**
   * The only place a campaign's budget is ever spent.
   *
   * It used to burn when the Payment Link was created, which meant a campaign
   * could exhaust its budget on baskets nobody paid for — chat, not commerce.
   * `markPaid` returns null on a second call for the same order, so this runs
   * exactly once per payment even if the refresh is polled repeatedly.
   */
  // Charge the campaigns that caused this sale. Only ever reached on the
  // markPaid transition, so a polled refresh cannot double count.
  burnForPaidOrder(flipped);

  // The bag has been bought, so it stops being a bag. A shopper returning to
  // /cart after paying should see an empty basket, not the one they just paid
  // for — which was the fastest way to accidentally buy the same thing twice.
  // Only the paid bag is cleared; an unpaid one is still theirs to finish.
  clearCart(DEMO_CART_ID);

  return flipped;
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireRole("customer");
  if (!auth.ok) return auth.response;

  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  if (keyId === "" || keySecret === "") {
    return Response.json({ error: "Razorpay credentials are not configured" }, { status: 500 });
  }

  let body: { order_id?: string } = {};
  try {
    body = (await request.json()) as { order_id?: string };
  } catch {
    // No body means "refresh everything still awaiting payment".
  }

  const creds = { keyId, keySecret };

  if (typeof body.order_id === "string" && body.order_id !== "") {
    const order = getOrder(body.order_id);
    if (order === null) return Response.json({ error: "no such order" }, { status: 404 });
    const updated = await refresh(order, creds);
    return Response.json({ order: updated, changed: updated.status !== order.status });
  }

  const pending = allOrders().filter((o) => o.status === "awaiting_payment");
  const results = await Promise.all(pending.map((o) => refresh(o, creds)));
  const flipped = results.filter((o) => o.status === "paid");

  return Response.json({
    checked: pending.length,
    now_paid: flipped.length,
    orders: results,
  });
}
