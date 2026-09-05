import { affordableHintBps } from "@countersign/campaigns";
import { priceCart } from "@countersign/catalog";
import { type AuditRecord, readAuditRecords } from "@countersign/ledger";
import { allOrders } from "@countersign/orders";
import { allQuotes } from "@countersign/quotes";

import { campaignById } from "@/lib/campaigns";
import { campaignNameOf } from "@/server/campaign-rows";
import { CATALOG } from "@/lib/catalog";
import { DEV_POLICY } from "@/lib/policy";
import { bestClearableBps } from "@/server/coupons";
import { isLiveQuote } from "@/server/live-rows";
import { moneyLedger, type MoneyRow } from "@/server/money-rows";
import { shopCodeFor } from "@/server/shop-code";
import { DEFAULT_TENANT } from "@/server/users";

/**
 * The code of the one shop this console belongs to.
 *
 * A merchant reading their own ledger is reading their own shop, so the code is
 * theirs. Null before a catalog exists, which is when there is nothing to sell
 * and nothing to have bought.
 */
function shopCodeForThisStore(): string | null {
  return shopCodeFor(DEFAULT_TENANT);
}

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

  /**
   * Whether we still hold the decision behind this payment.
   *
   * False for a payment Razorpay reports that our own log no longer describes —
   * the quote and audit rows live in /tmp on a serverless host and a cold start
   * takes them. Such a row is real money and must still appear; what it may not
   * do is claim a verdict, an ask or a margin gate it cannot evidence.
   */
  verdict_known: boolean;
  /** The shop this was bought from, when the row can be tied to one. */
  shop_code: string | null;
  /** What Razorpay actually took, which is not always what was asked for. */
  captured_paise: number | null;
  payment_link_id: string | null;
  /** Where the row came from, so the page can be honest about how much it knows. */
  source: "local" | "razorpay" | "both";
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
    /**
     * Which campaign this row belongs to, in order of what actually caused it.
     *
     * A BOGO row showed "none" because only `quote.campaign_id` was consulted,
     * and a merchant-created gift never sets that field — the campaign is on
     * the gift line. Order of preference: the campaign that gave the gift, then
     * one whose suggestion the shopper accepted and paid for, then the campaign
     * that was in play on the quote. Never a guess: if none of the three names
     * a campaign, the row says none.
     */
    const giftCampaign = (order?.gift_lines ?? q.gift_lines ?? [])
      .map((g) => g.from_campaign_id)
      .find((id): id is string => typeof id === "string" && id !== "") ?? null;
    const suggestedCampaign =
      Object.values(order?.line_origins ?? q.line_origins ?? {}).find(
        (id): id is string => typeof id === "string" && id !== "",
      ) ?? null;

    const campaignId = giftCampaign ?? suggestedCampaign ?? q.campaign_id;
    const campaignName = campaignNameOf(campaignId);

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
      campaign: campaignName ?? campaignId,
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
      campaign_dry: (() => {
        const seed = campaignId === null ? null : campaignById(campaignId);
        return seed !== null && affordableHintBps(seed, q.subtotal_paise) === 0;
      })(),

      // A row built from our own quote log knows its own decision by
      // definition. The Razorpay-only rows merged in later are the ones that
      // do not.
      verdict_known: true,
      shop_code: shopCodeForThisStore(),
      captured_paise: order?.status === "paid" ? order.amount_paise : null,
      payment_link_id: q.payment_link_id,
      source: "local",
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
  // No decision on file. Every branch below reasons from asked_bps, the margin
  // and the ladder gates; running them on zeros would invent a reason for a
  // payment we cannot explain, which is worse than admitting we cannot.
  if (!r.verdict_known) {
    return r.offer_id === null
      ? "Captured by Razorpay. The decision behind it is no longer in the local log."
      : `Captured by Razorpay with ${r.offer_id}. The decision behind it is no longer in the local log.`;
  }

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

  if (!r.verdict_known) {
    parts.push(
      `Razorpay reports this payment as captured${r.captured_paise === null ? "" : ` for ${rupees(r.captured_paise)}`}${r.payment_id === null ? "" : ` (${r.payment_id})`}.`,
    );
    if (r.offer_id !== null) parts.push(`The order carried ${r.offer_id}.`);
    parts.push(
      "What was asked for and what policy allowed are not on this row: the quote it came from is no longer in the local log. The payment itself is not in doubt — it is in the Razorpay dashboard.",
    );
    return parts.join(" ");
  }

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
  if (!r.verdict_known) {
    return [
      `Time          ${new Date(r.ts).toISOString()}`,
      `Shop          ${r.shop_code ?? "(unknown)"}`,
      `Verdict       captured by Razorpay (decision not in the local log)`,
      `Coupon        asked (unknown) -> allowed (unknown)`,
      `Offer         ${r.offer_id ?? "none"}`,
      `Money         ${r.captured_paise === null ? "(unknown)" : rupees(r.captured_paise)} captured`,
      `Payment       ${r.payment_id ?? "(none)"}`,
      `Link          ${r.payment_link_id ?? "(none)"}`,
      `Quote         ${r.quote_id === "" ? "(none)" : r.quote_id}`,
      ``,
      `Why: ${whyRow(r)}`,
    ].join("\n");
  }

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
    `Shop          ${r.shop_code ?? "(unknown)"}`,
    `Chain seq     ${r.seq ?? "(none)"}`,
    `Hash          ${r.hash ?? "(none)"}`,
    `Prev hash     ${r.prev_hash ?? "(none)"}`,
    ``,
    `Why: ${whyRow(r)}`,
  ].join("\n");
}

/**
 * Every payment, whether or not our own log still remembers deciding it.
 *
 * `paidLedgerRows` reads the quote log, which lives in `/tmp` on a serverless
 * host and does not survive a cold start. The audit page and the merchant
 * overview therefore went blank while the Razorpay dashboard showed captures —
 * the same failure the orders pages had, in the one place whose entire claim is
 * that it can account for money.
 *
 * So Razorpay is the backstop. Anything it reports as captured becomes a row.
 * Where the local log still describes the decision behind that payment, the two
 * are joined and the row says everything it used to. Where it does not, the row
 * says what it can prove and marks itself `verdict_known: false` rather than
 * inventing an ask, a margin gate or a verdict — and rather than disappearing,
 * which would tell a merchant nothing ever happened.
 */
export async function paidDecisionRows(): Promise<LedgerRow[]> {
  let local: LedgerRow[] = [];
  try {
    local = paidLedgerRows();
  } catch {
    // A missing or torn log is "no cache", never a broken page.
    local = [];
  }

  let ledger: Awaited<ReturnType<typeof moneyLedger>>;
  try {
    ledger = await moneyLedger();
  } catch {
    return local;
  }

  const byPaymentId = new Map(local.filter((r) => r.payment_id !== null).map((r) => [r.payment_id, r]));
  const byQuoteId = new Map(local.map((r) => [r.quote_id, r]));
  const byLinkId = new Map(
    local.filter((r) => r.payment_link_id !== null).map((r) => [r.payment_link_id, r]),
  );

  const used = new Set<string>();
  const out: LedgerRow[] = [];

  for (const m of ledger.rows) {
    if (m.status !== "paid") continue;

    const hit =
      (m.payment_id === null ? undefined : byPaymentId.get(m.payment_id)) ??
      (m.quote_id === null ? undefined : byQuoteId.get(m.quote_id)) ??
      (m.payment_link_id === null ? undefined : byLinkId.get(m.payment_link_id));

    if (hit !== undefined) {
      used.add(hit.key);
      // The local decision, with the figure Razorpay actually took. Those are
      // deliberately different numbers now that the coupon is applied by
      // Razorpay against a pre-coupon link amount.
      out.push({
        ...hit,
        captured_paise: m.amount_paise,
        payment_id: hit.payment_id ?? m.payment_id,
        payment_link_id: hit.payment_link_id ?? m.payment_link_id,
        source: "both",
      });
      continue;
    }

    out.push(razorpayOnlyRow(m));
  }

  // Anything the log has that Razorpay did not return — older than its window,
  // or captured against a different account. Still real history.
  for (const r of local) {
    if (!used.has(r.key)) out.push(r);
  }

  out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return out;
}

/**
 * A payment we can see but cannot explain.
 *
 * Every field that would require the quote is left at a value the renderers
 * treat as absent, and `verdict_known` is false so `causeOf`, `whyRow` and
 * `rowAsText` refuse to reason from it. The numbers that are present came from
 * Razorpay and are the ones a merchant can check in their dashboard.
 */
function razorpayOnlyRow(m: MoneyRow): LedgerRow {
  return {
    key: m.key,
    ts: m.paid_at ?? m.created_at,
    actor: "unknown",
    actor_kind: "customer",
    asked: m.summary === "" ? "not recorded" : m.summary,
    found: m.summary === "" ? "not recorded" : m.summary,
    campaign: null,
    upsell_accepted: null,
    asked_bps: 0,
    applied_bps: m.applied_bps ?? 0,
    offer_id: m.offer_id,
    attached: m.offer_id === null ? null : true,
    // The order amount is the pre-coupon basket when we raised the link that
    // way; falling back to the captured figure keeps the column honest rather
    // than showing a zero.
    subtotal_paise: m.order_amount_paise ?? m.amount_paise,
    total_paise: m.amount_paise,
    outcome: "paid",
    payment_id: m.payment_id,
    short_url: m.short_url,
    verdict: "CAPTURED",
    decision_id: null,
    quote_id: m.quote_id ?? "",
    order_id: m.razorpay_order_id,
    seq: null,
    hash: null,
    prev_hash: null,
    margin_bps: 0,
    live: true,
    campaign_dry: false,

    verdict_known: false,
    shop_code: m.quote_id === null ? null : shopCodeForThisStore(),
    captured_paise: m.amount_paise,
    payment_link_id: m.payment_link_id,
    source: "razorpay",
  };
}
