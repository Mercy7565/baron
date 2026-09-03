/**
 * @countersign/quotes
 *
 * A quote is a priced, bounded offer: what this buyer may pay for this basket,
 * with this discount, until this moment. It is the artifact an agent can hold
 * and a human can approve.
 *
 * Storage is append-only JSONL beside the audit ledger, with an in-memory index
 * rebuilt on first read. The audit ledger's own schema is untouched.
 *
 * `legal_total_paise` is computed here from catalog prices only. No caller-
 * supplied number ever reaches it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

export const QUOTES_VERSION = "0.1.0" as const;

/** Ten minutes, per the contract. */
export const QUOTE_TTL_MS = 10 * 60 * 1000;

export interface QuoteLine {
  /** True when this line is a campaign gift: shipped, never charged for. */
  gift?: boolean;
  /** The campaign that put this line in the bag, if any. */
  from_campaign_id?: string;
  sku_id: string;
  title: string;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
}

export interface QuoteUpsell {
  sku_id: string;
  title: string;
  price_paise: number;
  reason: string;
}

/**
 * `cancelled` is a buyer walking away from a price before any link existed.
 *
 * It is distinct from `superseded` (we re-priced it) and from an order's
 * `closed` (a link existed and was cancelled at Razorpay). Nothing about it
 * implies a payment, and a cancelled quote can never be issued a link.
 */
export type QuoteStatus =
  | "quoted"
  | "approved"
  | "superseded"
  | "link_issued"
  | "paid"
  | "cancelled";

export interface Quote {
  quote_id: string;
  status: QuoteStatus;
  created_at: string;
  expires_at: string;

  buyer_user_id: string;
  agent_id: string;
  mandate_hash: string;

  lines: QuoteLine[];
  /** Catalog subtotal before discount. */
  subtotal_paise: number;
  /** Catalog subtotal minus the discount the kernel actually allowed. */
  legal_total_paise: number;

  asked_bps: number;
  applied_bps: number;
  offer_id: string | null;

  campaign_id: string | null;
  /**
   * The exact basket this price is for: sorted `sku_id:qty`, joined.
   *
   * A price belongs to a basket, not to a session. Without this, "issue a link
   * for the newest quote" silently billed a *different* bag whenever the newest
   * quote was unusable — which is how a ₹3,096 cart opened a ₹2,292 link.
   */
  cart_fingerprint?: string;
  /** Campaign gifts on this order: shipped, never charged for. */
  gift_lines?: Array<{
    sku_id: string;
    title: string;
    qty: number;
    unit_price_paise: number;
    from_campaign_id: string | null;
  }>;
  /** sku_id -> the campaign whose suggestion put it in the bag. */
  line_origins?: Record<string, string>;
  /** The shopper's own words, when there were any. Null for API callers. */
  intent_text?: string | null;
  /** Whether the shopper accepted the suggestion. Null when none was offered. */
  upsell_accepted?: boolean | null;
  decision_id: string | null;
  verdict: string;

  upsell: QuoteUpsell[];
  mistakes_repaired: string[];
  ignored_inputs: string[];

  /** Set once paid. Presence of a payment_id is what makes pay idempotent. */
  payment_id: string | null;
  order_id: string | null;
  /** When a re-price supersedes this quote, the replacement id. */
  superseded_by: string | null;

  /** The Razorpay Payment Link issued for this quote, once there is one. */
  payment_link_id: string | null;
  payment_link_short_url: string | null;
}

// ------------------------------------------------------------------- the maths

/**
 * The only place a total is produced. Catalog price times quantity, less the
 * discount the kernel allowed, floored to whole paise.
 *
 * Never accepts an amount, total, or price from a request body.
 */
/**
 * Subtotal, and what is left after the coupon.
 *
 * `maxDiscountPaise` is the coupon's rupee cap. A percentage alone would let a
 * big basket walk away with an unbounded discount, so the cap is applied here,
 * where the money is actually computed, rather than being left as a number the
 * kernel reports and nobody enforces. Pass `null` when no coupon applied.
 */
export function computeLegalTotal(
  lines: QuoteLine[],
  appliedBps: number,
  maxDiscountPaise: number | null = null,
): {
  subtotal_paise: number;
  legal_total_paise: number;
  discount_paise: number;
  capped: boolean;
} {
  let subtotal = 0;
  for (const line of lines) subtotal += line.unit_price_paise * line.qty;

  const raw = Math.floor((subtotal * appliedBps) / 10_000);
  const capped = maxDiscountPaise !== null && raw > maxDiscountPaise;
  const discount = capped ? maxDiscountPaise : raw;

  return {
    subtotal_paise: subtotal,
    legal_total_paise: subtotal - discount,
    discount_paise: discount,
    capped,
  };
}

export function quoteId(seed: string): string {
  return `qt_${createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 20)}`;
}

export function isExpired(quote: Quote, now: Date): boolean {
  const exp = Date.parse(quote.expires_at);
  return Number.isNaN(exp) || exp <= now.getTime();
}

// ------------------------------------------------------------------ the store

export function quoteLogPath(): string {
  return resolve(process.env.QUOTE_LOG_PATH ?? ".data/quotes.jsonl");
}

const globalForQuotes = globalThis as typeof globalThis & {
  __countersign_quote_index?: Map<string, Quote>;
  __countersign_decision_to_quote?: Map<string, string>;
  __countersign_quotes_loaded?: boolean;
};

const INDEX: Map<string, Quote> =
  globalForQuotes.__countersign_quote_index ?? new Map<string, Quote>();
const DECISION_TO_QUOTE: Map<string, string> =
  globalForQuotes.__countersign_decision_to_quote ?? new Map<string, string>();

globalForQuotes.__countersign_quote_index = INDEX;
globalForQuotes.__countersign_decision_to_quote = DECISION_TO_QUOTE;

function isQuote(value: unknown): value is Quote {
  if (typeof value !== "object" || value === null) return false;
  const q = value as Partial<Quote>;
  return (
    typeof q.quote_id === "string" &&
    typeof q.legal_total_paise === "number" &&
    typeof q.expires_at === "string"
  );
}

/** Rebuild both indexes from the JSONL. Idempotent; runs once per process. */
export function loadQuotes(force = false): void {
  if (globalForQuotes.__countersign_quotes_loaded === true && !force) return;
  globalForQuotes.__countersign_quotes_loaded = true;

  INDEX.clear();
  DECISION_TO_QUOTE.clear();

  const path = quoteLogPath();
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      // A torn write must not take the index down.
      if (!isQuote(parsed)) continue;
      INDEX.set(parsed.quote_id, parsed);
      if (parsed.decision_id !== null) DECISION_TO_QUOTE.set(parsed.decision_id, parsed.quote_id);
    } catch {
      // Same reasoning for a line that is not JSON at all.
    }
  }
}

export function appendQuote(quote: Quote): Quote {
  loadQuotes();

  const path = quoteLogPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(quote)}\n`, "utf8");

  INDEX.set(quote.quote_id, quote);
  if (quote.decision_id !== null) DECISION_TO_QUOTE.set(quote.decision_id, quote.quote_id);
  return quote;
}

export function getQuote(id: string): Quote | null {
  loadQuotes();
  return INDEX.get(id) ?? null;
}

/**
 * Status changes are appended, never edited in place. The log stays append-only
 * and the index takes the last write for a quote_id, so a rebuild from disk
 * lands on the same state the running process had.
 */
export function updateQuote(id: string, patch: Partial<Quote>): Quote | null {
  const existing = getQuote(id);
  if (existing === null) return null;
  return appendQuote({ ...existing, ...patch, quote_id: existing.quote_id });
}

/**
 * Cancel a quote the buyer has walked away from.
 *
 * Refuses anything that already has a link or a payment: cancelling those would
 * hide real money, and a link is cancelled through the order path instead. This
 * creates nothing and calls nothing — it is the opposite of generating a link.
 */
export function cancelQuote(id: string, when = new Date()): Quote | null {
  const quote = getQuote(id);
  if (quote === null) return null;
  if (quote.payment_link_id !== null || quote.payment_id !== null) return null;
  if (quote.status === "cancelled") return quote;
  if (quote.status !== "quoted" && quote.status !== "approved") return null;

  return updateQuote(id, { status: "cancelled", expires_at: when.toISOString() });
}

/** Idempotency: a quote that already carries a payment_id must never charge twice. */
export function paymentForQuote(id: string): { payment_id: string; order_id: string | null } | null {
  const quote = getQuote(id);
  if (quote === null || quote.payment_id === null) return null;
  return { payment_id: quote.payment_id, order_id: quote.order_id };
}

/** The decision_id -> quote_id map, rebuilt from the JSONL on boot. */
export function quoteIdForDecision(decisionId: string): string | null {
  loadQuotes();
  return DECISION_TO_QUOTE.get(decisionId) ?? null;
}

export function allQuotes(): Quote[] {
  loadQuotes();
  return [...INDEX.values()];
}
