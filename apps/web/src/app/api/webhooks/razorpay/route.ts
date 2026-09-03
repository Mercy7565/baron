import {
  appendAuditRecord,
  findDecisionForOrder,
  hasEventRecord,
  hasPaymentRecord,
} from "@countersign/ledger";
import { fetchOrder, offersAttached, verifyWebhookSignature } from "@countersign/razorpay";

// Razorpay signs the raw request body, so this route must never run on a
// cached or pre-rendered path.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Events that mean money moved, or failed to. */
const AUDITED_EVENTS = new Set(["payment.captured", "order.paid", "payment.failed"]);

interface RazorpayEvent {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string } };
    order?: { entity?: { id?: string } };
  };
}

export async function POST(request: Request): Promise<Response> {
  const eventId = request.headers.get("x-razorpay-event-id");

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "webhook secret not configured" }, { status: 500 });
  }

  const signature = request.headers.get("x-razorpay-signature");

  // The signature is computed over these exact bytes. Read the body as text
  // before any JSON parsing, and never re-serialize it.
  const rawBody = await request.text();

  // HMAC-SHA256 over the raw body, compared with timingSafeEqual inside
  // verifyWebhookSignature. A failure is itself an auditable event: an
  // unsigned or wrongly-signed call at the money boundary is a security
  // signal, not a 404.
  if (signature === null || !verifyWebhookSignature(rawBody, signature, secret)) {
    appendAuditRecord({
      kind: "verify_fail",
      decision_id: null,
      order_id: null,
      payment_id: null,
      event_id: eventId,
      verdict: "—",
      offer_id: null,
      attached_ok: null,
      webhook_status: "verify_fail",
    });

    return Response.json(
      { error: signature === null ? "missing signature" : "invalid signature" },
      { status: 400 },
    );
  }

  // Nothing below this line runs on unverified bytes.
  let event: RazorpayEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayEvent;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const name = event.event ?? "";
  if (!AUDITED_EVENTS.has(name)) {
    // Acknowledge everything else, or Razorpay will retry forever.
    return Response.json({ received: true, audited: false, event: name }, { status: 200 });
  }

  // Retries are expected, and Razorpay redelivers the same event id. Either
  // key having been seen before means this is a replay.
  if (eventId !== null && hasEventRecord(eventId)) {
    return Response.json(
      { received: true, audited: false, reason: "duplicate_event_id" },
      { status: 200 },
    );
  }

  const paymentEntity = event.payload?.payment?.entity;
  const paymentId = paymentEntity?.id ?? null;
  const orderId = paymentEntity?.order_id ?? event.payload?.order?.entity?.id ?? null;

  if (paymentId !== null && hasPaymentRecord(paymentId)) {
    return Response.json(
      { received: true, audited: false, reason: "duplicate_payment_id" },
      { status: 200 },
    );
  }

  if (orderId === null) {
    return Response.json(
      { received: true, audited: false, reason: "no order id on event" },
      { status: 200 },
    );
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return Response.json({ error: "Razorpay credentials are not configured" }, { status: 500 });
  }

  // The event payload is not a trusted source for notes. Fetch the order and
  // read decision_id from that response instead.
  const result = await fetchOrder({ keyId, keySecret }, orderId);
  if (!result.ok) {
    // 500 so Razorpay retries: better to log late than not at all.
    return Response.json({ error: `could not read order: ${result.error}` }, { status: 500 });
  }

  const order = result.data;
  const notes = (order.notes ?? {}) as Record<string, string>;
  const decisionId = notes.decision_id ?? null;

  if (decisionId === null) {
    appendAuditRecord({
      kind: "payment",
      decision_id: null,
      order_id: order.id,
      payment_id: paymentId,
      event_id: eventId,
      verdict: "UNKNOWN",
      offer_id: null,
      attached_ok: offersAttached(order),
      webhook_status: "no_decision_id",
    });

    return Response.json(
      { received: true, audited: true, reason: "order has no decision_id in notes" },
      { status: 200 },
    );
  }

  // The verdict lives on the decision row written when the order was proposed.
  // Matched on order_id, because identical proposals share a decision_id while
  // Razorpay still mints a separate order for each.
  const decision = findDecisionForOrder(order.id);
  const attached = offersAttached(order);

  const record = appendAuditRecord({
    kind: "payment",
    decision_id: decisionId,
    order_id: order.id,
    payment_id: paymentId,
    event_id: eventId,
    verdict: decision?.verdict ?? "UNKNOWN",
    offer_id: attached ? (order.offers?.[0] ?? null) : null,
    attached_ok: attached,
    webhook_status: name === "payment.failed" ? "verified_failed_payment" : "verified",
  });

  return Response.json({ received: true, audited: true, record }, { status: 200 });
}
