/**
 * @countersign/mandates
 *
 * AP2-**shaped** local mandates.
 *
 * This is deliberately not AP2. There is no FIDO attestation, no verifiable
 * credential, no signature verification and no issuer trust chain. What we
 * borrow is the *shape*: a user-scoped intent that bounds what an agent may
 * spend, a cart that commits to that intent, and a payment that commits to that
 * cart. Each stage hashes the one before it, so an order's notes carry a single
 * mandate_hash that pins the whole chain.
 *
 * Do not describe this as AP2-conformant anywhere. It is "AP2-shaped local
 * mandates", and /protocols says so in those words.
 */
import { createHash } from "node:crypto";

export const MANDATES_VERSION = "0.1.0" as const;

/** Stable JSON: keys sorted at every level, so equal objects hash equal. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ---------------------------------------------------------------- the shapes

export interface IntentMandate {
  /** Subject: who this mandate is for. */
  sub: string;
  /** Ceiling on the order total, in paise. */
  max_amount_paise: number;
  /** Ceiling on the discount an agent may ask for, in bps. */
  max_discount_bps: number;
  /** Empty array means "any catalog SKU". */
  sku_allowlist: string[];
  /** Expiry, ISO 8601. */
  exp: string;
  /** Minted-at, ISO 8601. Part of the hash so two mandates never collide. */
  iat: string;
}

export interface CartMandate {
  items: Array<{ sku_id: string; qty: number }>;
  amount_paise: number;
  intent_hash: string;
}

export interface PaymentMandate {
  order_id: string;
  amount_paise: number;
  cart_hash: string;
}

export interface MandateBundle {
  intent: IntentMandate;
  cart: CartMandate | null;
  payment: PaymentMandate | null;
}

// -------------------------------------------------------------------- hashes

export function hashIntent(intent: IntentMandate): string {
  return sha256Hex(canonicalJson(intent));
}

export function hashCart(cart: CartMandate): string {
  return sha256Hex(canonicalJson(cart));
}

export function hashPayment(payment: PaymentMandate): string {
  return sha256Hex(canonicalJson(payment));
}

/**
 * The value written into an order's notes.mandate_hash.
 *
 * Chained: intent alone before a cart exists, intent+cart once items are known,
 * and intent+cart+payment once an order id exists. Each stage commits to the
 * previous one, so a mandate_hash cannot be reused against a different cart.
 */
export function mandateHash(bundle: MandateBundle): string {
  const parts: Record<string, string> = { intent: hashIntent(bundle.intent) };
  if (bundle.cart !== null) parts.cart = hashCart(bundle.cart);
  if (bundle.payment !== null) parts.payment = hashPayment(bundle.payment);
  return sha256Hex(canonicalJson(parts));
}

// ----------------------------------------------------------------- validation

export type MandateProblem =
  | "missing"
  | "expired"
  | "amount_over_intent"
  | "sku_not_allowed"
  | "malformed";

export interface IntentCheck {
  valid: boolean;
  problem: MandateProblem | null;
  message: string;
  /**
   * The discount the intent permits. Never above what was asked; the kernel
   * clamps further against the ladder and the margin floor.
   */
  allowed_discount_bps: number;
  /** True when the intent's ceiling reduced the ask. */
  discount_clamped: boolean;
}

export function isExpired(intent: IntentMandate, now: Date): boolean {
  const exp = Date.parse(intent.exp);
  return Number.isNaN(exp) || exp <= now.getTime();
}

/**
 * Check a proposed spend against the intent that is supposed to authorise it.
 *
 * Over-amount is a refusal: the human never agreed to that number. Over-discount
 * is a clamp: the human agreed to *at most* this much off, so asking for more
 * is simply reduced. That asymmetry is deliberate and is the whole point of a
 * mandate.
 */
export function checkAgainstIntent(
  intent: IntentMandate,
  amountPaise: number,
  requestedDiscountBps: number,
  skuIds: string[],
  now: Date,
): IntentCheck {
  if (isExpired(intent, now)) {
    return {
      valid: false,
      problem: "expired",
      message: `Mandate expired at ${intent.exp}.`,
      allowed_discount_bps: 0,
      discount_clamped: false,
    };
  }

  if (amountPaise > intent.max_amount_paise) {
    return {
      valid: false,
      problem: "amount_over_intent",
      message: `Cart is ${amountPaise} paise; the mandate authorises at most ${intent.max_amount_paise}.`,
      allowed_discount_bps: 0,
      discount_clamped: false,
    };
  }

  if (intent.sku_allowlist.length > 0) {
    const disallowed = skuIds.filter((id) => !intent.sku_allowlist.includes(id));
    if (disallowed.length > 0) {
      return {
        valid: false,
        problem: "sku_not_allowed",
        message: `Mandate does not cover: ${disallowed.join(", ")}.`,
        allowed_discount_bps: 0,
        discount_clamped: false,
      };
    }
  }

  const allowed = Math.min(requestedDiscountBps, intent.max_discount_bps);

  return {
    valid: true,
    problem: null,
    message:
      allowed < requestedDiscountBps
        ? `Mandate caps discount at ${intent.max_discount_bps} bps; ask reduced from ${requestedDiscountBps}.`
        : "Within mandate.",
    allowed_discount_bps: allowed,
    discount_clamped: allowed < requestedDiscountBps,
  };
}

/** A demo intent for the dev UI. Short-lived on purpose. */
export function mintDemoIntent(now: Date, ttlMinutes = 60): IntentMandate {
  return {
    sub: "demo-shopper",
    /**
     * These bounds have to sit at or above the store's own, or they become a
     * second, invisible policy. `max_discount_bps` was 1500 while the coupon
     * ladder went to 2500, so a basket that genuinely qualified for 20% was
     * quietly clamped to 15% — and the clamp landed in different places
     * depending on which mandate priced the basket, so the on-screen total and
     * the Payment Link could disagree. The kernel is the thing that decides a
     * coupon; this is only meant to stop a runaway agent.
     */
    max_amount_paise: 5_000_000,
    max_discount_bps: 2500,
    sku_allowlist: [],
    iat: now.toISOString(),
    exp: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
  };
}
