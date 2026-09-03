import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * @countersign/orders
 *
 * An append-only order log on disk.
 *
 * The status rule is the whole point: an order is `awaiting_payment` from the
 * moment a Payment Link is issued, and only becomes `paid` when Razorpay says
 * a payment exists against that link. Nothing here ever marks an order paid on
 * its own initiative — unpaid must never look like revenue.
 *
 * Storage is JSONL beside the audit and quote logs, with the index rebuilt from
 * disk on first read, so a customer's purchase is visible to a merchant on the
 * same machine after a refresh with no shared memory between them.
 */

export const ORDERS_VERSION = "0.1.0" as const;

/**
 * `closed` is ours, not Razorpay's: a buyer who walks away from a link should
 * not keep seeing it, and the merchant should not keep counting it as money on
 * the way in. It never implies a payment happened — only `paid` does that, and
 * only Razorpay can cause it.
 */
export type OrderStatus = "awaiting_payment" | "paid" | "closed";

export interface Order {
  order_id: string;
  quote_id: string;
  buyer_user_id: string;
  agent_id: string;

  /** Razorpay order id created through the propose path. */
  razorpay_order_id: string | null;
  payment_link_id: string;
  short_url: string;

  amount_paise: number;
  asked_bps: number;
  applied_bps: number;
  offer_id: string | null;
  verdict: string;

  lines: Array<{ sku_id: string; title: string; qty: number; line_total_paise: number }>;
  /**
   * Campaign gifts shipped with this order.
   *
   * Kept apart from `lines` because they are not part of `amount_paise`: a gift
   * is given, not discounted. Both lists are shown to the shopper and to the
   * merchant, so an order reads as what was actually in the box.
   */
  gift_lines?: Array<{
    sku_id: string;
    title: string;
    qty: number;
    unit_price_paise: number;
    from_campaign_id: string | null;
  }>;
  /** sku_id -> the campaign whose suggestion put that paid line in the bag. */
  line_origins?: Record<string, string>;

  status: OrderStatus;
  /** Only ever set from what Razorpay reports. Never minted here. */
  razorpay_payment_id: string | null;
  created_at: string;
  paid_at: string | null;
  /** When the buyer closed the link. Null unless status is `closed`. */
  closed_at?: string | null;
  /** Whether Razorpay accepted the cancel, or we only closed it on our side. */
  cancelled_at_razorpay?: boolean;
}

export function ordersLogPath(): string {
  return resolve(process.env.ORDERS_LOG_PATH ?? ".data/orders.jsonl");
}

const globalForOrders = globalThis as typeof globalThis & {
  __countersign_orders?: Map<string, Order>;
};

function isOrder(value: unknown): value is Order {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Partial<Order>;
  return (
    typeof o.order_id === "string" &&
    typeof o.payment_link_id === "string" &&
    typeof o.amount_paise === "number" &&
    // Every status the log may legitimately contain. A status missing from
    // this list is silently dropped on reload, which lets a superseded row win
    // and resurrects an order in its old state — so adding an OrderStatus means
    // adding it here too.
    (o.status === "awaiting_payment" || o.status === "paid" || o.status === "closed")
  );
}

/**
 * Rebuild the index from disk. Last write for an order_id wins, so a status
 * change appended later supersedes the row that created it.
 */
export function loadOrders(force = false): Map<string, Order> {
  if (globalForOrders.__countersign_orders !== undefined && !force) {
    return globalForOrders.__countersign_orders;
  }

  const map = new Map<string, Order>();
  const path = ordersLogPath();

  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (line.trim() === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        // A torn write is skipped rather than corrupting the ledger of orders.
        if (isOrder(parsed)) map.set(parsed.order_id, parsed);
      } catch {
        // Same for a line that is not JSON at all.
      }
    }
  }

  globalForOrders.__countersign_orders = map;
  return map;
}

export function appendOrder(order: Order): Order {
  const map = loadOrders();
  const path = ordersLogPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(order)}\n`, "utf8");
  map.set(order.order_id, order);
  return order;
}

export function getOrder(id: string): Order | null {
  return loadOrders().get(id) ?? null;
}

/** Status changes are appended, never edited in place. */
export function updateOrder(id: string, patch: Partial<Order>): Order | null {
  const existing = getOrder(id);
  if (existing === null) return null;
  return appendOrder({ ...existing, ...patch, order_id: existing.order_id });
}

export function allOrders(): Order[] {
  return [...loadOrders().values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** What a customer may see: their own orders, and only the paid ones. */
export function paidOrdersFor(buyerUserId: string): Order[] {
  return allOrders().filter((o) => o.buyer_user_id === buyerUserId && o.status === "paid");
}

/** What a merchant sees, split so unpaid never reads as revenue. */
export function ordersByStatus(status: OrderStatus): Order[] {
  return allOrders().filter((o) => o.status === status);
}

export function findByPaymentLink(linkId: string): Order | null {
  for (const o of loadOrders().values()) {
    if (o.payment_link_id === linkId) return o;
  }
  return null;
}

/**
 * Mark an order paid.
 *
 * `paymentId` must come from Razorpay. Callers that cannot produce one must not
 * call this — an order with no payment id is not a paid order.
 */
/**
 * Record a payment Razorpay has confirmed.
 *
 * Returns null when the order is already paid, so a caller can treat a non-null
 * result as "this is the transition" and do the once-per-payment work — burning
 * a campaign's budget, for instance — without double counting when the refresh
 * endpoint is polled.
 */
export function markPaid(id: string, paymentId: string, when = new Date()): Order | null {
  if (paymentId === "") return null;

  const existing = getOrder(id);
  if (existing === null || existing.status === "paid") return null;

  return updateOrder(id, {
    status: "paid",
    razorpay_payment_id: paymentId,
    paid_at: when.toISOString(),
  });
}

/**
 * Close an unpaid link so it stops appearing as money on the way in.
 *
 * A paid order is never closed — that would erase a real payment from the
 * customer's history — so this refuses on anything but `awaiting_payment`.
 * `cancelledAtRazorpay` records whether the API actually cancelled the link or
 * whether we only stopped showing it, because those are different facts and the
 * merchant is entitled to know which one happened.
 */
export function markClosed(
  id: string,
  cancelledAtRazorpay: boolean,
  when = new Date(),
): Order | null {
  const order = getOrder(id);
  if (order === null || order.status !== "awaiting_payment") return null;
  return updateOrder(id, {
    status: "closed",
    closed_at: when.toISOString(),
    cancelled_at_razorpay: cancelledAtRazorpay,
  });
}

/** Every link this buyer has that is still open and payable. */
export function unpaidOrdersFor(buyerUserId: string): Order[] {
  return allOrders().filter(
    (o) => o.buyer_user_id === buyerUserId && o.status === "awaiting_payment",
  );
}

/** Drop the cache so the next read comes from disk, as a fresh process would. */
export function reloadOrders(): void {
  delete globalForOrders.__countersign_orders;
}

/** One English sentence about what happened to this order's money. */
export function explainOrder(o: Order): string {
  const clamped = o.asked_bps > o.applied_bps;
  const discount = clamped
    ? `You asked for ${o.asked_bps / 100}% and policy allowed ${o.applied_bps / 100}%`
    : `Policy allowed the ${o.applied_bps / 100}% that was asked for`;

  const offer = o.offer_id === null ? "with no offer attached" : `via ${o.offer_id}`;

  return o.status === "paid"
    ? `${discount} ${offer}. You paid ₹${(o.amount_paise / 100).toFixed(2)} on Razorpay (${o.razorpay_payment_id ?? "payment recorded"}).`
    : `${discount} ${offer}. The Payment Link is issued for ₹${(o.amount_paise / 100).toFixed(2)} and is still awaiting payment.`;
}
