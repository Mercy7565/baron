import {
  fetchOrder,
  fetchPaymentLink,
  listOrders,
  listPaymentLinks,
  listPayments,
  type PaymentLinkRow,
  type RazorpayOrder,
  type RazorpayPayment,
} from "@countersign/razorpay";
import { allOrders, type Order } from "@countersign/orders";

/**
 * What money actually moved, according to Razorpay.
 *
 * The JSONL logs under `.data/` are a cache and nothing more. On a serverless
 * host they live in /tmp, which is per-instance and does not survive a cold
 * start, so an order that was genuinely paid can disappear from the file while
 * the payment sits in the Razorpay dashboard for anyone to see. A ledger that
 * reads only the file therefore reports "no orders" about money that plainly
 * exists, which is the one thing this product may never do.
 *
 * So the account is the source of truth and the log is an enrichment: Razorpay
 * says *that* money moved, the log says *what it was for*. A row missing its
 * quote, its line items or its campaign is still a row — it just says less.
 */

export interface MoneyRow {
  /** Stable key: the payment if there is one, else the link, else the order. */
  key: string;
  status: "paid" | "awaiting_payment" | "closed" | "failed";

  /** What Razorpay actually captured. The number that is really money. */
  amount_paise: number;
  /**
   * What the order was raised for, when that differs from what was captured.
   * A gap between the two is Razorpay applying an offer at capture time, and
   * it is the only honest evidence that a coupon attached.
   */
  order_amount_paise: number | null;

  payment_id: string | null;
  payment_link_id: string | null;
  razorpay_order_id: string | null;
  short_url: string | null;

  offer_id: string | null;
  asked_bps: number | null;
  applied_bps: number | null;

  quote_id: string | null;
  order_id: string | null;
  buyer_user_id: string | null;

  /** Item names when the log still has them, else a plain sentence. */
  summary: string;
  lines: Order["lines"];
  gift_lines: NonNullable<Order["gift_lines"]>;

  created_at: string;
  paid_at: string | null;

  /** Where this row came from, so the UI can be honest about how much it knows. */
  source: "razorpay" | "local" | "both";
}

export interface MoneyLedger {
  rows: MoneyRow[];
  /** True when Razorpay answered. False means these rows are cache only. */
  live: boolean;
  /** Razorpay's own words when it did not answer. Never invented. */
  error: string | null;
  counts: { paid: number; awaiting: number; closed: number; failed: number };
}

const iso = (unixSeconds: number | null | undefined): string =>
  typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : "";

/** Payment Links whose payment ids we will look up individually. */
const RESOLVE_LINK_CAP = 25;

function credentials(): { keyId: string; keySecret: string } | null {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  return keyId === "" || keySecret === "" ? null : { keyId, keySecret };
}

function noteString(notes: unknown, key: string): string | null {
  if (typeof notes !== "object" || notes === null) return null;
  const value = (notes as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The offer on an order.
 *
 * Razorpay returns `offers: null` on most order reads even when an offer did
 * attach, so an absent value is not evidence of no discount — the amount gap
 * is. This only reports an id it was actually given.
 */
function offerOn(order: RazorpayOrder | undefined): string | null {
  const offers = order?.offers;
  return Array.isArray(offers) && offers.length > 0 ? (offers[0] ?? null) : null;
}

function statusOfLink(link: PaymentLinkRow): MoneyRow["status"] {
  if (link.status === "paid") return "paid";
  if (link.status === "cancelled" || link.status === "expired") return "closed";
  return "awaiting_payment";
}

/**
 * Ask Razorpay what happened, and describe it in our own vocabulary.
 *
 * Every failure is swallowed into `live: false` plus the reason. A page that
 * throws because a payment provider was slow is a page that tells a merchant
 * their shop is broken when it is not.
 */
async function fromRazorpay(): Promise<{
  rows: MoneyRow[];
  live: boolean;
  error: string | null;
}> {
  const creds = credentials();
  if (creds === null) {
    return { rows: [], live: false, error: "Razorpay credentials are not configured." };
  }

  let payments: RazorpayPayment[] = [];
  let links: PaymentLinkRow[] = [];
  let orders: RazorpayOrder[] = [];

  try {
    const [p, l, o] = await Promise.all([
      listPayments(creds, 100),
      listPaymentLinks(creds, 100),
      listOrders(creds, 100),
    ]);

    // One failing call should not blank the other two.
    const failed = [p, l, o].find((r) => !r.ok);
    if (p.ok) payments = p.data;
    if (l.ok) links = l.data;
    if (o.ok) orders = o.data;

    if (failed !== undefined && !failed.ok && !p.ok && !l.ok) {
      return { rows: [], live: false, error: failed.error };
    }
  } catch (err) {
    return {
      rows: [],
      live: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const orderById = new Map(orders.map((o) => [o.id, o]));

  /**
   * Which offer actually attached.
   *
   * The orders *collection* returns `offers: null` even on an order that
   * carries one — the same list-versus-read gap the payment links have, and
   * just as silent. So the orders behind captured payments are read
   * individually, capped, and only where the list left the question open.
   */
  const capturedOrderIds = [
    ...new Set(
      payments
        .filter((p) => p.status === "captured" && p.order_id !== null)
        .map((p) => p.order_id as string)
        .filter((id) => (orderById.get(id)?.offers ?? null) === null),
    ),
  ].slice(0, RESOLVE_LINK_CAP);

  const readBack = await Promise.all(
    capturedOrderIds.map(async (id) => {
      try {
        const r = await fetchOrder(creds, id);
        return r.ok ? r.data : null;
      } catch {
        return null;
      }
    }),
  );
  for (const o of readBack) {
    if (o !== null) orderById.set(o.id, o);
  }

  /**
   * Which payment paid which link.
   *
   * The list endpoint returns `payments: []` on a link it simultaneously
   * reports as paid, so the pay id only exists on the individual read. That is
   * also why the old refresh never flipped anything: it looked for a payment id
   * in an array Razorpay does not populate on a list.
   */
  const paidLinks = links.filter((l) => l.status === "paid").slice(0, RESOLVE_LINK_CAP);
  const linkByPaymentId = new Map<string, PaymentLinkRow>();

  const details = await Promise.all(
    paidLinks.map(async (l) => {
      try {
        const r = await fetchPaymentLink(creds, l.id);
        return r.ok ? r.data : null;
      } catch {
        return null;
      }
    }),
  );

  details.forEach((detail, i) => {
    const link = paidLinks[i];
    if (detail === null || link === undefined) return;
    for (const pay of detail.payments ?? []) {
      if (typeof pay.payment_id === "string" && pay.payment_id !== "") {
        linkByPaymentId.set(pay.payment_id, link);
      }
    }
  });

  const rows: MoneyRow[] = [];
  const linksAccountedFor = new Set<string>();

  // ---- a real payment is a row, whatever the log says ----------------------
  for (const pay of payments) {
    if (pay.status === "created" || pay.status === "authorized") continue;

    const order = pay.order_id === null ? undefined : orderById.get(pay.order_id);
    const link = linkByPaymentId.get(pay.id) ?? null;
    if (link !== null) linksAccountedFor.add(link.id);

    rows.push({
      key: pay.id,
      status: pay.status === "failed" ? "failed" : "paid",
      amount_paise: pay.amount,
      order_amount_paise: order?.amount ?? null,
      payment_id: pay.id,
      payment_link_id: link?.id ?? null,
      razorpay_order_id: pay.order_id,
      short_url: link?.short_url ?? null,
      offer_id: offerOn(order),
      asked_bps: null,
      applied_bps: null,
      quote_id:
        noteString(link?.notes, "quote_id") ?? noteString(order?.notes, "quote_id"),
      order_id: null,
      buyer_user_id: null,
      summary: "",
      lines: [],
      gift_lines: [],
      created_at: iso(pay.created_at),
      paid_at: pay.status === "failed" ? null : iso(pay.created_at),
      source: "razorpay",
    });
  }

  // ---- links: paid ones we could not tie to a payment, plus open ones ------
  for (const link of links) {
    if (linksAccountedFor.has(link.id)) continue;

    const orderId = noteString(link.notes, "order_id");
    const order = orderId === null ? undefined : orderById.get(orderId);

    rows.push({
      key: link.id,
      status: statusOfLink(link),
      amount_paise: link.amount,
      order_amount_paise: order?.amount ?? null,
      payment_id: null,
      payment_link_id: link.id,
      razorpay_order_id: orderId,
      short_url: link.short_url,
      offer_id: offerOn(order),
      asked_bps: null,
      applied_bps: null,
      quote_id: noteString(link.notes, "quote_id"),
      order_id: null,
      buyer_user_id: null,
      summary: "",
      lines: [],
      gift_lines: [],
      created_at: iso(link.created_at),
      paid_at: link.status === "paid" ? iso(link.created_at) : null,
      source: "razorpay",
    });
  }

  return { rows, live: true, error: null };
}

/** Everything the local log knows, indexed the three ways a row can match it. */
function localIndex(): {
  byPaymentId: Map<string, Order>;
  byLinkId: Map<string, Order>;
  byRazorpayOrderId: Map<string, Order>;
  all: Order[];
} {
  let all: Order[] = [];
  try {
    all = allOrders();
  } catch {
    // A missing or unreadable log is "no cache", never an error page.
    all = [];
  }

  const byPaymentId = new Map<string, Order>();
  const byLinkId = new Map<string, Order>();
  const byRazorpayOrderId = new Map<string, Order>();

  for (const o of all) {
    if (o.razorpay_payment_id !== null) byPaymentId.set(o.razorpay_payment_id, o);
    if (o.payment_link_id !== "") byLinkId.set(o.payment_link_id, o);
    if (o.razorpay_order_id !== null) byRazorpayOrderId.set(o.razorpay_order_id, o);
  }

  return { byPaymentId, byLinkId, byRazorpayOrderId, all };
}

function describe(order: Order): string {
  return order.lines.map((l) => `${l.title} × ${l.qty}`).join(", ");
}

/** Fold what the log knows into a row Razorpay already vouched for. */
function enrich(row: MoneyRow, order: Order): MoneyRow {
  return {
    ...row,
    offer_id: row.offer_id ?? order.offer_id,
    asked_bps: order.asked_bps,
    applied_bps: order.applied_bps,
    quote_id: row.quote_id ?? order.quote_id,
    order_id: order.order_id,
    buyer_user_id: order.buyer_user_id,
    summary: describe(order),
    lines: order.lines,
    gift_lines: order.gift_lines ?? [],
    short_url: row.short_url ?? order.short_url,
    payment_link_id: row.payment_link_id ?? order.payment_link_id,
    source: "both",
  };
}

function fromLocalOnly(order: Order): MoneyRow {
  return {
    key: order.order_id,
    status: order.status === "paid" ? "paid" : order.status === "closed" ? "closed" : "awaiting_payment",
    amount_paise: order.amount_paise,
    order_amount_paise: null,
    payment_id: order.razorpay_payment_id,
    payment_link_id: order.payment_link_id,
    razorpay_order_id: order.razorpay_order_id,
    short_url: order.short_url,
    offer_id: order.offer_id,
    asked_bps: order.asked_bps,
    applied_bps: order.applied_bps,
    quote_id: order.quote_id,
    order_id: order.order_id,
    buyer_user_id: order.buyer_user_id,
    summary: describe(order),
    lines: order.lines,
    gift_lines: order.gift_lines ?? [],
    created_at: order.created_at,
    paid_at: order.paid_at,
    source: "local",
  };
}

/**
 * The merged ledger: Razorpay first, the log folded in where it still exists.
 *
 * Never throws. A page that renders this can always render something, which is
 * the whole point — the alternative is a 500 on a shop that is working fine.
 */
export async function moneyLedger(): Promise<MoneyLedger> {
  const [remote, local] = await Promise.all([
    fromRazorpay().catch((err: unknown) => ({
      rows: [] as MoneyRow[],
      live: false,
      error: err instanceof Error ? err.message : String(err),
    })),
    Promise.resolve(localIndex()),
  ]);

  const usedLocal = new Set<string>();

  const merged = remote.rows.map((row) => {
    const hit =
      (row.payment_id === null ? undefined : local.byPaymentId.get(row.payment_id)) ??
      (row.payment_link_id === null ? undefined : local.byLinkId.get(row.payment_link_id)) ??
      (row.razorpay_order_id === null
        ? undefined
        : local.byRazorpayOrderId.get(row.razorpay_order_id));

    if (hit === undefined) return row;
    usedLocal.add(hit.order_id);
    return enrich(row, hit);
  });

  // Anything the log has that Razorpay did not return — an older order beyond
  // the 100-row window, or a link closed on our side only. Still the buyer's.
  for (const order of local.all) {
    if (usedLocal.has(order.order_id)) continue;
    merged.push(fromLocalOnly(order));
  }

  merged.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  const counts = { paid: 0, awaiting: 0, closed: 0, failed: 0 };
  for (const r of merged) {
    if (r.status === "paid") counts.paid += 1;
    else if (r.status === "awaiting_payment") counts.awaiting += 1;
    else if (r.status === "closed") counts.closed += 1;
    else counts.failed += 1;
  }

  return { rows: merged, live: remote.live, error: remote.error, counts };
}

/**
 * The same ledger, narrowed to one buyer.
 *
 * A row the log can still attribute belongs to that buyer alone. A row it
 * cannot — because /tmp was wiped — has no owner on this side at all, and
 * hiding it would recreate the exact bug this module exists to fix: money that
 * moved, shown nowhere. Those rows are marked `source: "razorpay"` so the page
 * can say plainly that it no longer knows whose basket they were.
 */
export async function moneyLedgerFor(buyerUserId: string): Promise<MoneyLedger> {
  const ledger = await moneyLedger();
  const rows = ledger.rows.filter(
    (r) => r.buyer_user_id === null || r.buyer_user_id === buyerUserId,
  );

  const counts = { paid: 0, awaiting: 0, closed: 0, failed: 0 };
  for (const r of rows) {
    if (r.status === "paid") counts.paid += 1;
    else if (r.status === "awaiting_payment") counts.awaiting += 1;
    else if (r.status === "closed") counts.closed += 1;
    else counts.failed += 1;
  }

  return { ...ledger, rows, counts };
}
