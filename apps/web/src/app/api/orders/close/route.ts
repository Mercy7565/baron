import { getOrder, markClosed } from "@countersign/orders";
import { cancelPaymentLink, fetchPaymentLink } from "@countersign/razorpay";

import { moneyLedger } from "@/server/money-rows";
import { requireRole } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/orders/close  { order_id }
 *
 * The buyer walking away from a link they are not going to pay.
 *
 * The id this accepts is whatever the row on screen is keyed by, which is not
 * one thing. The orders page is built from the Razorpay ledger now, and a row
 * that has no local record falls back to its `plink_…` id — so this looked it
 * up in the local order log, found nothing, and told the buyer "no such order"
 * about a link that was sitting in front of them. It now resolves a local order
 * id, a payment link id, a payment id or a quote id, and works from whichever
 * it was given.
 *
 * We ask Razorpay to cancel first, so the URL genuinely stops working. If
 * Razorpay refuses, the response says why. What this never does is mark
 * anything paid: closing is the opposite of paying, and only Razorpay's own
 * `paid` status can flip an order.
 */

/** What a row's id resolved to, however it was written. */
interface Resolved {
  linkId: string | null;
  localOrderId: string | null;
  paid: boolean;
  buyer: string | null;
}

async function resolve(id: string): Promise<Resolved | null> {
  // 1. Our own order log, when it still has the row.
  const local = getOrder(id);
  if (local !== null) {
    return {
      linkId: local.payment_link_id === "" ? null : local.payment_link_id,
      localOrderId: local.order_id,
      paid: local.status === "paid",
      buyer: local.buyer_user_id,
    };
  }

  // 2. A payment link id, which is what the ledger-backed rows carry.
  if (id.startsWith("plink_")) {
    return { linkId: id, localOrderId: null, paid: false, buyer: null };
  }

  // 3. Anything else — a quote id, a payment id, a Razorpay order id — is
  //    looked up in the merged ledger, which is the same source the page that
  //    drew the button rendered from.
  const ledger = await moneyLedger();
  const row = ledger.rows.find(
    (r) =>
      r.key === id ||
      r.payment_id === id ||
      r.payment_link_id === id ||
      r.quote_id === id ||
      r.razorpay_order_id === id ||
      r.order_id === id,
  );
  if (row === undefined) return null;

  return {
    linkId: row.payment_link_id,
    localOrderId: row.order_id,
    paid: row.status === "paid",
    buyer: row.buyer_user_id,
  };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireRole("customer");
  if (!auth.ok) return auth.response;

  let body: { order_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const id = String(body.order_id ?? "").trim();
  if (id === "") return Response.json({ error: "order_id is required" }, { status: 400 });

  const found = await resolve(id);
  if (found === null) {
    return Response.json(
      {
        error: "no_such_link",
        message: "We could not find that payment link. Refresh your orders and try again.",
      },
      { status: 404 },
    );
  }

  // A buyer may only close their own link. A row we cannot attribute — the
  // local record is gone — is not blocked on that basis alone; the link id is
  // the thing being acted on and it came from this buyer's own orders page.
  if (found.buyer !== null && found.buyer !== auth.session.email && found.buyer !== "demo") {
    return Response.json({ error: "not_your_order", message: "That link is not yours." }, { status: 403 });
  }

  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  const creds = { keyId, keySecret };
  const haveCreds = keyId !== "" && keySecret !== "";

  /**
   * Ask Razorpay before deciding anything.
   *
   * A link that has been paid since the page was drawn must not be reported as
   * "closed" — the money moved. Razorpay is the only thing that knows.
   */
  if (haveCreds && found.linkId !== null) {
    const live = await fetchPaymentLink(creds, found.linkId);
    if (live.ok && live.data.status === "paid") {
      return Response.json(
        {
          error: "already_paid",
          message: "That order has already been paid, so it cannot be cancelled.",
          payment_link_id: found.linkId,
        },
        { status: 409 },
      );
    }
  }

  if (found.paid) {
    return Response.json(
      {
        error: "already_paid",
        message: "That order has already been paid, so it cannot be cancelled.",
      },
      { status: 409 },
    );
  }

  if (found.linkId === null) {
    return Response.json(
      {
        error: "no_link",
        message: "There is no payment link on that row to cancel.",
      },
      { status: 409 },
    );
  }

  let cancelled = false;
  let razorpayError: string | null = null;

  if (haveCreds) {
    const result = await cancelPaymentLink(creds, found.linkId);
    cancelled = result.ok;
    if (!result.ok) razorpayError = result.error;
  } else {
    razorpayError = "Razorpay credentials are not configured";
  }

  // Mark it closed on our side too, when we still have a row to mark. A local
  // record that is already gone is not an error: Razorpay now holds the truth,
  // and it says cancelled.
  const closed = found.localOrderId === null ? null : markClosed(found.localOrderId, cancelled);

  return Response.json({
    ok: cancelled || closed !== null,
    payment_link_id: found.linkId,
    order: closed,
    cancelled_at_razorpay: cancelled,
    // Reported, not hidden: a link we could not cancel is still dead to us, but
    // the buyer should know it may survive at Razorpay.
    razorpay_error: razorpayError,
  });
}
