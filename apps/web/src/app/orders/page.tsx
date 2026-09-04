import { Package } from "lucide-react";

import { allQuotes } from "@countersign/quotes";

import { StoreChrome } from "@/components/StoreChrome";
import { buyerId } from "@/server/require-role";
import { moneyLedgerFor, type MoneyRow } from "@/server/money-rows";

import { RefreshOrders } from "./RefreshOrders";
import { UnpaidLinks, type UnpaidRow } from "./UnpaidLinks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rupees = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;

/**
 * One sentence about a row, using only what we can still prove.
 *
 * After the local log is gone there are no line items and no basis points to
 * talk about, so the sentence shrinks to the two facts Razorpay vouches for:
 * what was charged, and against which order. It never fills the gap with a
 * guess about what was in the basket.
 */
function explainRow(r: MoneyRow): string {
  const parts: string[] = [];

  if (r.order_amount_paise !== null && r.order_amount_paise !== r.amount_paise) {
    const off = r.order_amount_paise - r.amount_paise;
    parts.push(
      `Razorpay charged ${rupees(r.amount_paise)} against an order of ${rupees(
        r.order_amount_paise,
      )} — ${rupees(off)} came off at checkout.`,
    );
  } else {
    parts.push(`Razorpay captured ${rupees(r.amount_paise)}.`);
  }

  if (r.applied_bps !== null) {
    parts.push(
      r.applied_bps === 0
        ? "No coupon applied to this basket."
        : `${r.applied_bps / 100}% coupon applied${r.offer_id === null ? "" : ` · ${r.offer_id}`}.`,
    );
  }

  if (r.source === "razorpay") {
    parts.push("The basket this paid for is no longer in the local log.");
  }

  return parts.join(" ");
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const showing: "paid" | "unpaid" = tab === "unpaid" ? "unpaid" : "paid";

  const buyer = await buyerId();

  /**
   * Money first, log second.
   *
   * This used to read `paidOrdersFor(buyer)` alone, which on a serverless host
   * meant reading a file in /tmp that a cold start had already thrown away. The
   * payments were still in Razorpay; the page just could not see them, and
   * reported "nothing paid for yet" about money that had very much been paid.
   */
  const ledger = await moneyLedgerFor(buyer);
  const paid = ledger.rows.filter((r) => r.status === "paid");
  const unpaid = ledger.rows.filter((r) => r.status === "awaiting_payment");

  /**
   * Unpaid bags that never became a link.
   *
   * Expired ones are included on purpose. Hiding them made a bag that timed out
   * vanish from the Unpaid tab while staying on the books — the buyer could
   * neither pay it nor close it. It is still their bag; they should be able to
   * clear it.
   *
   * This list is cache-only by nature: a quote that never reached Razorpay
   * exists nowhere else, so an empty /tmp legitimately means none.
   */
  let pending: ReturnType<typeof allQuotes> = [];
  try {
    pending = allQuotes().filter(
      (q) =>
        q.buyer_user_id === buyer &&
        q.payment_link_id === null &&
        q.status !== "cancelled" &&
        q.status !== "superseded" &&
        q.status !== "paid" &&
        (q.verdict === "ALLOW" || q.verdict === "CLAMP"),
    );
  } catch {
    // No quote log is "no pending quotes", never a broken page.
    pending = [];
  }

  const unpaidRows: UnpaidRow[] = unpaid
    // A link needs a URL to be openable; a row without one is not actionable.
    .filter((r) => r.short_url !== null)
    .map((r) => ({
      order_id: r.order_id ?? r.payment_link_id ?? r.key,
      short_url: r.short_url ?? "",
      amount_paise: r.amount_paise,
      created_at: r.created_at,
      summary: r.summary === "" ? "A basket priced earlier" : r.summary,
    }));

  return (
    <StoreChrome>
      <h1>Your orders</h1>
      <p className="st-lede">
        An order appears under Paid once Razorpay confirms the payment — not when the link is
        created.
      </p>
      <p className="page-help">
        Paid orders are read from Razorpay, so they stay here once a payment goes through. Unpaid
        holds baskets you have priced but not paid for.
      </p>

      {!ledger.live && (
        <p className="st-note" style={{ margin: "0 0 16px" }}>
          Could not reach Razorpay just now, so this shows only what is cached locally.
          {ledger.error === null ? "" : ` Razorpay said: ${ledger.error}`}
        </p>
      )}

      <div className="st-tabs">
        <a className={showing === "paid" ? "st-tab is-on" : "st-tab"} href="/orders?tab=paid">
          Paid ({paid.length})
        </a>
        <a className={showing === "unpaid" ? "st-tab is-on" : "st-tab"} href="/orders?tab=unpaid">
          Unpaid ({unpaidRows.length + pending.length})
        </a>
        <span style={{ flex: 1 }} />
        {(unpaidRows.length > 0 || paid.length > 0) && (
          <RefreshOrders label="Check for new payments" auto />
        )}
      </div>

      {showing === "unpaid" ? (
        <UnpaidLinks
          rows={unpaidRows}
          pending={pending.map((q) => ({
            quote_id: q.quote_id,
            summary: q.lines.map((l) => `${l.title} × ${l.qty}`).join(", "),
            total_paise: q.legal_total_paise,
            applied_bps: q.applied_bps,
            offer_id: q.offer_id,
            created_at: q.created_at,
          }))}
        />
      ) : paid.length === 0 ? (
        <div className="st-empty">
          <Package size={26} strokeWidth={1.5} aria-hidden />
          <p>
            {unpaidRows.length > 0
              ? `Nothing paid for yet. You have ${unpaidRows.length} payment link${unpaidRows.length === 1 ? "" : "s"} waiting — pay one on Razorpay, then check again.`
              : "Nothing paid for yet. Ask the assistant for something and it will price it for you."}
          </p>
          <div className="st-actions">
            <a className="st-btn" href="/agent">
              Talk to the assistant
            </a>
            {unpaidRows.length > 0 && (
              <a className="st-btn st-btn--quiet" href="/orders?tab=unpaid">
                See unpaid links
              </a>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {paid.map((r) => (
            <PaidCard key={r.key} row={r} />
          ))}
        </div>
      )}
    </StoreChrome>
  );
}

/**
 * One paid row.
 *
 * Only clickable when a local order still backs it — the detail page is built
 * from the log, so linking a Razorpay-only row would hand the buyer a 404.
 */
function PaidCard({ row }: { row: MoneyRow }) {
  const inner = (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 17 }}>
            {row.summary === "" ? "Paid on Razorpay" : row.summary}
          </div>
          {row.gift_lines.map((g) => (
            <div key={g.sku_id} style={{ fontSize: 15, marginTop: 2 }}>
              {g.title} × {g.qty} <span className="ct-gift">Free</span>
            </div>
          ))}
          <div className="st-muted" style={{ fontSize: 14, marginTop: 4 }}>
            Paid · {row.paid_at?.slice(0, 10) ?? ""}
            {row.payment_id === null ? "" : ` · ${row.payment_id}`}
          </div>
        </div>
        <strong className="nl-money" style={{ fontSize: 19 }}>
          {rupees(row.amount_paise)}
        </strong>
      </div>
      <p className="st-muted" style={{ fontSize: 14, margin: "12px 0 0" }}>
        {explainRow(row)}
      </p>
    </>
  );

  if (row.order_id === null) {
    return <div className="st-card">{inner}</div>;
  }

  return (
    <a
      className="st-card"
      href={`/orders/${row.order_id}`}
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
      {inner}
    </a>
  );
}
