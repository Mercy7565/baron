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
