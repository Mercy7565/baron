import { affordableHintBps } from "@countersign/campaigns";
import { priceCart } from "@countersign/catalog";
import { type AuditRecord, readAuditRecords } from "@countersign/ledger";
import { allOrders } from "@countersign/orders";
import { allQuotes } from "@countersign/quotes";

import { campaignById } from "@/lib/campaigns";
import { CATALOG } from "@/lib/catalog";
import { DEV_POLICY } from "@/lib/policy";
import { bestClearableBps } from "@/server/coupons";
import { isLiveQuote } from "@/server/live-rows";

/**
 * One money decision, assembled for a human to read.
 *
 * The three logs each hold part of the story and none holds all of it: the
 * quote knows what was asked and what policy allowed, the order knows what
 * happened to the link afterwards, and the audit chain knows the decision id
 * and the hashes that make the row tamper-evident. A merchant should not have
 * to join those by hand, so this does it once, here, and the page just renders.
 */
export interface LedgerRow {
  key: string;
  ts: string;
  /** Who drove it: a signed-in shopper, or an agent calling the API. */
  actor: string;
  actor_kind: "customer" | "agent";
  /** What they asked for, in words where we have them. */
  asked: string;
  /** What the catalog resolved it to. */
  found: string;
  campaign: string | null;
  upsell_accepted: boolean | null;
  asked_bps: number;
  applied_bps: number;
  offer_id: string | null;
  /** Whether Razorpay actually attached the offer to the order. */
  attached: boolean | null;
  subtotal_paise: number;
  total_paise: number;
  outcome: "no link" | "link" | "paid" | "closed";
  payment_id: string | null;
  short_url: string | null;
  verdict: string;
  decision_id: string | null;
  quote_id: string;
  order_id: string | null;
  seq: number | null;
  hash: string | null;
  prev_hash: string | null;
  /** Blended margin on the basket, needed to say which gate bound. */
  margin_bps: number;
  /** False when this row names a coupon from a retired set. */
  live: boolean;
  /** True when a campaign was in play but had no budget left. */
  campaign_dry: boolean;
}

const rupees = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;

/**
 * The audit row that recorded this decision, matched on decision id.
 *
 * Rows written before schema_version 2 carry no quote_id, so the decision id is
 * the only reliable join. A quote with no matching audit row still renders —
 * missing chain fields are shown as absent rather than faked.
 */
function auditFor(records: AuditRecord[], decisionId: string | null): AuditRecord | null {
  if (decisionId === null) return null;
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i];
    if (r !== undefined && r.decision_id === decisionId) return r;
  }
  return null;
}

export function ledgerRows(): LedgerRow[] {
  const quotes = allQuotes();
  const orders = allOrders();
  const records = readAuditRecords();

  const rows = quotes.map((q): LedgerRow => {
    const order = orders.find((o) => o.quote_id === q.quote_id) ?? null;
    const audit = auditFor(records, q.decision_id);

    const outcome: LedgerRow["outcome"] =
      order === null
        ? q.payment_link_id === null
          ? "no link"
          : "link"
        : order.status === "paid"
          ? "paid"
          : order.status === "closed"
            ? "closed"
            : "link";

    const isAgent = q.agent_id !== "" && q.agent_id !== "unknown";

    // Recomputed from the catalog rather than stored: the margin is what tells
    // a reader whether the floor or the cart size shut a coupon out, and a
    // quote never carried it.
    const priced = priceCart(
      CATALOG,
      q.lines.map((l) => ({ sku_id: l.sku_id, qty: l.qty })),
    );
    const campaign = q.campaign_id === null ? null : campaignById(q.campaign_id);

    return {
      key: q.quote_id,
      ts: q.created_at,
      actor: q.buyer_user_id,
      actor_kind: isAgent ? "agent" : "customer",
      asked:
        q.intent_text != null && q.intent_text !== ""
          ? q.intent_text
          : `${q.asked_bps / 100}% on ${q.lines.length} line${q.lines.length === 1 ? "" : "s"}`,
      found: q.lines.map((l) => `${l.title} ×${l.qty}`).join(", ") || "—",
      campaign: campaign?.name ?? (q.campaign_id === null ? null : q.campaign_id),
      upsell_accepted: q.upsell_accepted ?? null,
      asked_bps: q.asked_bps,
      applied_bps: q.applied_bps,
      offer_id: q.offer_id,
      attached: audit?.attached_ok ?? null,
      subtotal_paise: q.subtotal_paise,
      total_paise: q.legal_total_paise,
      outcome,
      payment_id: order?.razorpay_payment_id ?? null,
      short_url: order?.short_url ?? null,
      verdict: q.verdict,
      decision_id: q.decision_id,
      quote_id: q.quote_id,
      order_id: q.order_id,
      seq: audit?.seq ?? null,
      hash: audit?.hash ?? null,
      prev_hash: audit?.prev_hash ?? null,
      margin_bps: priced.margin_bps,
      live: isLiveQuote(q),
      campaign_dry:
        campaign !== null && affordableHintBps(campaign, q.subtotal_paise) === 0,
    };
  });

  // Newest first: a merchant opening this page is looking at what just
  // happened, not at the beginning of time.
  return rows.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

/**
 * Only decisions where money actually moved.
 *
 * The ledger used to show one row per priced basket, so a shopper who asked
 * three questions produced three rows and the page read as a chat log. A
 * merchant's ledger should hold payments: one row per Razorpay-confirmed
 * payment, and nothing else. Unpaid baskets still live on the customer's
 * unpaid tab, where a shopper can act on them.
 */
export function paidLedgerRows(): LedgerRow[] {
  return ledgerRows().filter((r) => r.outcome === "paid" && r.payment_id !== null);
}

/** The coupon percentage behind an offer id, for a pill that must not say "unknown". */
export function couponPercentOf(offerId: string | null): string | null {
  if (offerId === null) return null;
  const rung = DEV_POLICY.ladder.find((r) => r.offer_id === offerId);
  return rung === undefined ? null : `${rung.discount_bps / 100}%`;
}

/**
 * The one real cause, in one sentence, for the merchant table.
 *
 * Every branch names a mechanism a merchant can act on — the cart was too
 * small, the margin floor bound, the campaign is out of money, the shopper said
 * no, Razorpay did or did not attach the coupon. Nothing here says "rung", and
 * nothing here says "clamped" without saying what did the clamping.
 */
export function causeOf(r: LedgerRow): string {
  if (r.verdict === "REJECT") return "Policy refused the basket, so no order was created.";

  const clearable = bestClearableBps(r.subtotal_paise, r.margin_bps);

  // Nothing applied at all: say which gate shut it out.
  if (r.applied_bps === 0) {
    const smallest = DEV_POLICY.ladder.reduce(
      (m, x) => (x.min_cart_paise < m ? x.min_cart_paise : m),
      Number.POSITIVE_INFINITY,
    );
    if (r.subtotal_paise < smallest) {
      return `Basket under ${rupees(smallest)}, the smallest coupon's minimum, so none applied.`;
    }
    return `Margin floor of ${DEV_POLICY.margin_floor_bps / 100}% left no room, so no coupon applied.`;
  }

  // Something applied, but less than the ask.
  if (r.applied_bps < r.asked_bps) {
    const nextUp = DEV_POLICY.ladder
      .filter((x) => x.discount_bps > r.applied_bps && x.discount_bps <= r.asked_bps)
      .sort((a, b) => a.discount_bps - b.discount_bps)[0];

    if (nextUp !== undefined && r.subtotal_paise < nextUp.min_cart_paise) {
      return `${nextUp.discount_bps / 100}% needs a ${rupees(nextUp.min_cart_paise)} basket; this one was ${rupees(r.subtotal_paise)}, so ${r.applied_bps / 100}% applied.`;
    }
    return `${nextUp === undefined ? "More" : `${nextUp.discount_bps / 100}%`} would have pushed margin under the ${DEV_POLICY.margin_floor_bps / 100}% floor, so ${r.applied_bps / 100}% applied.`;
  }

  // The ask was met. Say what let it through, and flag a campaign that is dry.
  if (r.campaign_dry) {
    return `${r.applied_bps / 100}% applied — the best this basket clears. ${r.campaign ?? "The campaign"} has no budget left to suggest more.`;
  }
  if (r.upsell_accepted === false && clearable > r.applied_bps) {
    return `Shopper declined the add-on, so the basket stayed at ${r.applied_bps / 100}%.`;
  }
  if (r.attached === false && r.offer_id !== null) {
    return `${r.applied_bps / 100}% was allowed but Razorpay did not attach ${r.offer_id}.`;
  }
  return `${r.applied_bps / 100}% applied — the best coupon this basket clears on size and margin.`;
}

/**
 * The short English answer to "why did this happen?".
 *
 * Written for someone who does not know what a basis point is, and deliberately
 * says which of the three gates bound — the ask, the cart size, or the margin
 * floor — because that is the question a merchant actually has.
 */
export function whyRow(r: LedgerRow): string {
  const parts: string[] = [];

  if (r.verdict === "REJECT") {
    parts.push("Policy refused this basket outright, so no Razorpay order and no link were created.");
  } else if (r.applied_bps === 0 && r.asked_bps > 0) {
    parts.push(
      `We asked for ${r.asked_bps / 100}% and policy allowed nothing. At ${rupees(r.subtotal_paise)} this cart is either below the smallest coupon's minimum, or the discount would have pushed margin under the floor.`,
    );
  } else if (r.applied_bps < r.asked_bps) {
    parts.push(
      `We asked for ${r.asked_bps / 100}% and policy allowed ${r.applied_bps / 100}%. The bigger coupons need a larger cart or more margin than this basket had, so it clamped down to the largest one that actually qualified.`,
    );
  } else {
    parts.push(
      `We asked for ${r.asked_bps / 100}% and policy allowed all of it — the cart cleared that coupon's minimum and kept margin above the floor.`,
    );
  }

  if (r.campaign !== null) {
    parts.push(`${r.campaign} was the campaign in play; it can raise what we ask for, never mint a coupon.`);
  }

  if (r.upsell_accepted === true) parts.push("The shopper accepted the suggested add-on.");
  else if (r.upsell_accepted === false) parts.push("The shopper declined the suggested add-on.");

  if (r.offer_id !== null) {
    parts.push(
      r.attached === true
        ? `Razorpay attached ${r.offer_id} to the order.`
        : r.attached === false
          ? `We sent ${r.offer_id} but Razorpay attached nothing — the id is probably not live on this account.`
          : `Coupon ${r.offer_id} was selected; whether Razorpay attached it was not recorded on this row.`,
    );
  }

  parts.push(
    r.outcome === "paid"
      ? `Paid on Razorpay${r.payment_id === null ? "" : ` (${r.payment_id})`}.`
      : r.outcome === "closed"
        ? "The buyer closed the link without paying."
        : r.outcome === "link"
          ? "A Payment Link was issued."
          : "No Payment Link was issued for this decision.",
  );

  return parts.join(" ");
}

/** The copy-to-clipboard form of one row: readable, and complete enough to audit. */
export function rowAsText(r: LedgerRow): string {
  return [
    `Decision      ${r.decision_id ?? "(none)"}`,
    `Time          ${new Date(r.ts).toISOString()}`,
    `Actor         ${r.actor} (${r.actor_kind})`,
    `Asked         ${r.asked}`,
    `Found         ${r.found}`,
    `Campaign      ${r.campaign ?? "none"}`,
    `Upsell        ${r.upsell_accepted === null ? "not offered" : r.upsell_accepted ? "accepted" : "declined"}`,
    `Coupon        asked ${r.asked_bps / 100}% -> allowed ${r.applied_bps / 100}%`,
    `Offer         ${r.offer_id ?? "none"} (${r.attached === null ? "attachment not recorded" : r.attached ? "attached" : "NOT attached"})`,
    `Money         ${rupees(r.subtotal_paise)} subtotal -> ${rupees(r.total_paise)} to pay`,
    `Verdict       ${r.verdict}`,
    `Outcome       ${r.outcome}${r.payment_id === null ? "" : ` (${r.payment_id})`}`,
    `Quote         ${r.quote_id}`,
    `Order         ${r.order_id ?? "(none)"}`,
    `Chain seq     ${r.seq ?? "(none)"}`,
    `Hash          ${r.hash ?? "(none)"}`,
    `Prev hash     ${r.prev_hash ?? "(none)"}`,
    ``,
    `Why: ${whyRow(r)}`,
  ].join("\n");
}
