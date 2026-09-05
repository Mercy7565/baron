/**
 * @countersign/razorpay
 *
 * Razorpay client + webhook helpers. Keeps every Razorpay-shaped detail in one
 * place so the rest of the system talks in our own vocabulary.
 *
 * Two API facts are baked into the types here, both learned the hard way in
 * Day 1 recon (see docs/SANDBOX_NOTES.md):
 *   - offers must be bare id strings. `[{ offer_id }]` returns 200 and attaches
 *     nothing at all.
 *   - line_items is rejected outright, and we never send it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const RAZORPAY_VERSION = "0.1.0" as const;

const API_BASE = "https://api.razorpay.com/v1";

// ------------------------------------------------------------------ webhooks

/**
 * Verify a Razorpay webhook signature (HMAC-SHA256 of the raw request body,
 * keyed with the webhook secret). Compare against the `x-razorpay-signature`
 * header. Raw body — not a re-serialized JSON object.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// -------------------------------------------------------------------- orders

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

export interface CreateOrderInput {
  amount_paise: number;
  currency: "INR";
  receipt: string;
  notes: Record<string, string>;
  /**
   * Bare offer id strings. The type is `string[]` on purpose: the object form
   * `[{ offer_id }]` is unrepresentable here, because it silently no-ops.
   * When non-empty, `force_offer: true` is sent alongside.
   */
  offer_ids: string[];
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
  /**
   * Populated only when offers actually attached. Razorpay returns `null` on a
   * plain order and omits the key entirely on some order types (recurring
   * auth), so callers must treat undefined as "none".
   */
  offers?: string[] | null;
  notes: unknown;
  created_at: number;
}

export type RazorpayResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; body: unknown };

function authHeader(creds: RazorpayCredentials): string {
  return `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}`;
}

function describeError(body: unknown, status: number): string {
  const parsed = body as { error?: { description?: string } } | undefined;
  return parsed?.error?.description ?? `Razorpay returned HTTP ${status}`;
}

/**
 * Create an order. Returns a result rather than throwing so callers can decide
 * how a payment-provider failure surfaces.
 */
export async function createOrder(
  creds: RazorpayCredentials,
  input: CreateOrderInput,
): Promise<RazorpayResult<RazorpayOrder>> {
  const body: Record<string, unknown> = {
    amount: input.amount_paise,
    currency: input.currency,
    receipt: input.receipt,
    notes: input.notes,
  };

  // Only send the offer fields when there is an offer to apply — an empty
  // offers array is not the same thing as "no discount".
  if (input.offer_ids.length > 0) {
    body.offers = input.offer_ids;
    body.force_offer = true;
  }

  let status = 0;
  let parsed: unknown;

  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers: {
        authorization: authHeader(creds),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    status = res.status;
    const raw = await res.text();
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = raw;
    }
    if (!res.ok) {
      return { ok: false, status, error: describeError(parsed, status), body: parsed };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      body: null,
    };
  }

  return { ok: true, data: parsed as RazorpayOrder };
}

/** Read one order back, by id. */
export async function fetchOrder(
  creds: RazorpayCredentials,
  orderId: string,
): Promise<RazorpayResult<RazorpayOrder>> {
  let status = 0;
  let parsed: unknown;

  try {
    const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}`, {
      headers: { authorization: authHeader(creds) },
    });
    status = res.status;
    const raw = await res.text();
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = raw;
    }
    if (!res.ok) {
      return { ok: false, status, error: describeError(parsed, status), body: parsed };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      body: null,
    };
  }

  return { ok: true, data: parsed as RazorpayOrder };
}

/**
 * Did the offers we asked for actually attach? Razorpay can return 200 with
 * `offers: null`, so a created order is not proof that a discount applied.
 */
export function offersAttached(order: RazorpayOrder): boolean {
  return Array.isArray(order.offers) && order.offers.length > 0;
}

// ------------------------------------------------------------- payment links

export interface PaymentLink {
  id: string;
  short_url: string;
  status: string;
  amount: number;
  /** Present once the link has been paid. */
  payments?: Array<{ payment_id?: string; status?: string }> | null;
  /**
   * Whatever we stamped on the link at creation.
   *
   * Razorpay copies these onto the payment and onto the order the link creates,
   * which makes them the one record of a decision that outlives our own files.
   */
  notes?: unknown;
}

/**
 * Create a Payment Link for an amount.
 *
 * Notifications are off: this link exists so the buyer (or a human)
 * can complete it, not so Razorpay messages anyone. Confirmed working in recon.
 */
export async function createPaymentLink(
  creds: RazorpayCredentials,
  input: {
    amount_paise: number;
    description: string;
    reference_id: string;
    notes: Record<string, string>;
    /**
     * The offers to pin onto the order this link creates.
     *
     * Always sent, and an empty array is meaningful rather than a no-op. Left
     * to itself Razorpay attaches every offer whose minimum cart the amount
     * clears and applies the largest — which is how a link raised for an
     * already-discounted total came back discounted a second time. Sending
     * `force_offer` with exactly the rung the kernel chose, or with nothing at
     * all, is what makes the captured amount predictable.
     */
    offer_ids: string[];
  },
): Promise<RazorpayResult<PaymentLink>> {
  const body = {
    amount: input.amount_paise,
    currency: "INR",
    description: input.description,
    reference_id: input.reference_id,
    notes: input.notes,
    notify: { sms: false, email: false },
    reminder_enable: false,
    // `options.order` is passed through to the order the link creates. This is
    // the only place that order can be reached before it exists.
    options: { order: { offers: input.offer_ids, force_offer: true } },
  };

  let status = 0;
  let parsed: unknown;

  try {
    const res = await fetch(`${API_BASE}/payment_links`, {
      method: "POST",
      headers: { authorization: authHeader(creds), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    status = res.status;
    const raw = await res.text();
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = raw;
    }
    if (!res.ok) {
      return { ok: false, status, error: describeError(parsed, status), body: parsed };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      body: null,
    };
  }

  return { ok: true, data: parsed as PaymentLink };
}

/** Read a Payment Link back, to see whether it was actually paid. */
export async function fetchPaymentLink(
  creds: RazorpayCredentials,
  linkId: string,
): Promise<RazorpayResult<PaymentLink>> {
  let status = 0;
  let parsed: unknown;

  try {
    const res = await fetch(`${API_BASE}/payment_links/${encodeURIComponent(linkId)}`, {
      headers: { authorization: authHeader(creds) },
    });
    status = res.status;
    const raw = await res.text();
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = raw;
    }
    if (!res.ok) {
      return { ok: false, status, error: describeError(parsed, status), body: parsed };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      body: null,
    };
  }

  return { ok: true, data: parsed as PaymentLink };
}

/**
 * Cancel a Payment Link so it can no longer be paid.
 *
 * Razorpay only allows this while the link is still open — cancelling one that
 * is already paid, expired or cancelled comes back as a 400, which is the
 * correct answer and not something to retry. The caller decides what to do with
 * a refusal; this never pretends a cancel succeeded.
 */
export async function cancelPaymentLink(
  creds: RazorpayCredentials,
  linkId: string,
): Promise<RazorpayResult<PaymentLink>> {
  let status = 0;
  let parsed: unknown;

  try {
    const res = await fetch(
      `${API_BASE}/payment_links/${encodeURIComponent(linkId)}/cancel`,
      {
        method: "POST",
        headers: { authorization: authHeader(creds), "content-type": "application/json" },
      },
    );
    status = res.status;
    const raw = await res.text();
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = raw;
    }
    if (!res.ok) {
      return { ok: false, status, error: describeError(parsed, status), body: parsed };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      body: null,
    };
  }

  return { ok: true, data: parsed as PaymentLink };
}

// --------------------------------------------------------------- listing
//
// Reading money back out of Razorpay, rather than out of our own log.
//
// The log is a cache. On a serverless host it lives in /tmp, which is per
// instance and does not survive a cold start, so an order that was very much
// paid can vanish from the file while the money is still sitting in the
// Razorpay dashboard. These three list calls are the source of truth: whatever
// Razorpay says was captured, was captured.

/** One row of a Razorpay collection response. */
interface Collection<T> {
  items?: T[] | null;
}

export interface RazorpayPayment {
  id: string;
  amount: number;
  currency: string;
  /** "created" | "authorized" | "captured" | "refunded" | "failed" */
  status: string;
  order_id: string | null;
  invoice_id: string | null;
  method?: string | null;
  description?: string | null;
  email?: string | null;
  contact?: string | null;
  notes?: unknown;
  created_at: number;
}

/** A Payment Link as the list endpoint returns it — richer than the create shape. */
export interface PaymentLinkRow extends PaymentLink {
  amount_paid?: number | null;
  reference_id?: string | null;
  description?: string | null;
  notes?: unknown;
  created_at?: number | null;
  order_id?: string | null;
}

async function apiGet<T>(
  creds: RazorpayCredentials,
  path: string,
): Promise<RazorpayResult<T>> {
  let status = 0;
  let parsed: unknown;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { authorization: authHeader(creds) },
      // Never let a stale CDN or fetch cache answer a question about money.
      cache: "no-store",
    });
    status = res.status;
    const raw = await res.text();
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = raw;
    }
    if (!res.ok) {
      return { ok: false, status, error: describeError(parsed, status), body: parsed };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      body: null,
    };
  }

  return { ok: true, data: parsed as T };
}

/**
 * Recent payments on the account, newest first.
 *
 * `count` is capped at 100 by Razorpay; asking for more is a 400, not a longer
 * list, so the cap is applied here rather than discovered in production.
 */
export async function listPayments(
  creds: RazorpayCredentials,
  count = 100,
): Promise<RazorpayResult<RazorpayPayment[]>> {
  const n = Math.max(1, Math.min(100, Math.trunc(count)));
  const res = await apiGet<Collection<RazorpayPayment>>(creds, `/payments?count=${n}`);
  return res.ok ? { ok: true, data: res.data.items ?? [] } : res;
}

/**
 * Recent Payment Links on the account.
 *
 * Note the response shape: this endpoint answers with `payment_links`, not the
 * `items` every other collection uses. Reading `items` here returns an empty
 * list on a perfectly good response, which looks exactly like "no links".
 */
export async function listPaymentLinks(
  creds: RazorpayCredentials,
  count = 100,
): Promise<RazorpayResult<PaymentLinkRow[]>> {
  const n = Math.max(1, Math.min(100, Math.trunc(count)));
  const res = await apiGet<{ payment_links?: PaymentLinkRow[] | null }>(
    creds,
    `/payment_links?count=${n}`,
  );
  return res.ok ? { ok: true, data: res.data.payment_links ?? [] } : res;
}

/**
 * Recent orders, which is where the attached offer actually lives.
 *
 * A payment does not carry the offer that discounted it; the order it belongs
 * to does. Listing orders once is cheaper than fetching one per payment, and it
 * is the only way to show a real offer id after the local log is gone.
 */
export async function listOrders(
  creds: RazorpayCredentials,
  count = 100,
): Promise<RazorpayResult<RazorpayOrder[]>> {
  const n = Math.max(1, Math.min(100, Math.trunc(count)));
  const res = await apiGet<Collection<RazorpayOrder>>(creds, `/orders?count=${n}`);
  return res.ok ? { ok: true, data: res.data.items ?? [] } : res;
}
