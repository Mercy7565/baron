import { ConsoleChrome } from "@/components/ConsoleChrome";
import { moneyLedger, type MoneyRow } from "@/server/money-rows";
import { hydrateOverlay } from "@/server/overlay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rupees = (paise: number): string => `₹${(paise / 100).toLocaleString("en-IN")}`;

/** The short "why" under a row, built only from what is still provable. */
function why(r: MoneyRow): string {
  const bits: string[] = [];
  if (r.order_amount_paise !== null && r.order_amount_paise !== r.amount_paise) {
    bits.push(
      `order raised for ${rupees(r.order_amount_paise)}, captured ${rupees(r.amount_paise)}`,
    );
  }
  if (r.applied_bps !== null) bits.push(`${r.applied_bps / 100}% applied`);
  if (r.quote_id !== null) bits.push(r.quote_id);
  if (r.source === "razorpay") bits.push("Razorpay only — no local basket");
  return bits.join(" · ");
}

export default async function MerchantOrders({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // Merchant state is durable and shared; pull it into this instance
  // before anything reads a campaign, a catalog edit or the margin floor.
  await hydrateOverlay();

  const { tab } = await searchParams;
  const showing: "paid" | "awaiting_payment" | "closed" =
    tab === "awaiting" ? "awaiting_payment" : tab === "closed" ? "closed" : "paid";

  /**
   * The Razorpay account, with the local log folded in.
   *
   * This page used to read `ordersByStatus` alone — a file in /tmp on a
   * serverless host, which a cold start deletes. The merchant then saw an empty
   * Orders page while the Razorpay dashboard showed captured payments, which is
   * the worst possible thing for a console whose entire claim is that it tells
   * you the truth about money.
   */
  const ledger = await moneyLedger();

  const paid = ledger.rows.filter((r) => r.status === "paid");
  const awaiting = ledger.rows.filter((r) => r.status === "awaiting_payment");
  const closed = ledger.rows.filter((r) => r.status === "closed");
  const failed = ledger.rows.filter((r) => r.status === "failed");

  const rows =
    showing === "paid" ? paid : showing === "closed" ? [...closed, ...failed] : awaiting;

  // Revenue is what Razorpay captured, never what a link was raised for.
  const revenue = paid.reduce((n, r) => n + r.amount_paise, 0);
  const pipeline = awaiting.reduce((n, r) => n + r.amount_paise, 0);

  return (
    <ConsoleChrome current="/merchant/orders">
      <h1>Orders</h1>
      <p className="mc-sub">
        Paid and awaiting are kept apart on purpose. An issued Payment Link is not revenue until
        Razorpay reports a payment against it.
      </p>
      <p className="page-help">
        Every paid row carries a payment id you can look up in your Razorpay dashboard. Awaiting
        holds links that have been sent but not paid.
      </p>

      {!ledger.live && (
        <div className="mc-banner" style={{ marginBottom: 12 }}>
          Could not reach Razorpay just now — this is the local cache only.
          {ledger.error === null ? "" : ` Razorpay said: ${ledger.error}`}
        </div>
      )}

      <div className="mc-grid" style={{ marginBottom: 12 }}>
        <div className="mc-stat">
          <div className="v" style={{ color: "var(--ok)" }}>
            {rupees(revenue)}
          </div>
          <div className="k">captured · {paid.length} paid</div>
        </div>
        <div className="mc-stat">
          <div className="v" style={{ color: "var(--muted)" }}>
            {rupees(pipeline)}
          </div>
          <div className="k">awaiting payment · {awaiting.length} links</div>
        </div>
        <div className="mc-stat">
          <div className="v" style={{ color: "var(--muted)" }}>
            {ledger.live ? "live" : "cache"}
          </div>
          <div className="k">
            {ledger.live ? "read from Razorpay just now" : "Razorpay unreachable"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <a
          className={showing === "paid" ? "mc-btn" : "mc-btn mc-btn--quiet"}
          href="/merchant/orders?tab=paid"
        >
          Paid ({paid.length})
        </a>
        <a
          className={showing === "awaiting_payment" ? "mc-btn" : "mc-btn mc-btn--quiet"}
          href="/merchant/orders?tab=awaiting"
        >
          Awaiting payment ({awaiting.length})
        </a>
        <a
          className={showing === "closed" ? "mc-btn" : "mc-btn mc-btn--quiet"}
          href="/merchant/orders?tab=closed"
        >
          Closed ({closed.length + failed.length})
        </a>
      </div>

      <div className="mc-panel">
        {rows.length === 0 ? (
          <div className="mc-empty">
            {showing === "paid"
              ? "No payments captured on this Razorpay account yet. A link becomes an order here once Razorpay confirms it."
              : showing === "closed"
                ? "No links have been closed or failed."
                : "No links awaiting payment."}
          </div>
        ) : (
          <table className="mc-table">
            <thead>
              <tr>
                <th>Items</th>
                <th className="num">Asked</th>
                <th className="num">Applied</th>
                <th>Offer</th>
                <th>Payment</th>
                <th>Payment link</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} title={why(r)}>
                  <td>
                    {r.summary === "" ? (
                      <span style={{ color: "var(--muted)" }}>
                        {r.quote_id === null ? "Paid on Razorpay" : `Quote ${r.quote_id}`}
                      </span>
                    ) : (
                      r.summary
                    )}
                    {r.gift_lines.map((g) => (
                      <div key={g.sku_id} className="mc-tiny">
                        {g.title} × {g.qty} — free with {g.from_campaign_id ?? "a campaign"}
                      </div>
                    ))}
                    {r.source === "razorpay" && (
                      <div className="mc-tiny">items not recorded on this payment</div>
                    )}
                  </td>
                  <td className="num">{r.asked_bps === null ? "—" : `${r.asked_bps / 100}%`}</td>
                  <td className="num">
                    {r.applied_bps === null ? "—" : `${r.applied_bps / 100}%`}
                  </td>
                  <td>{r.offer_id ?? "—"}</td>
                  <td className="mono">
                    {r.payment_id === null ? (
                      "—"
                    ) : (
                      <span title={r.payment_id}>{r.payment_id}</span>
                    )}
                  </td>
                  <td>
                    {r.payment_link_id === null ? (
                      "—"
                    ) : r.short_url === null ? (
                      <span className="mono">{r.payment_link_id}</span>
                    ) : (
                      <a href={r.short_url} target="_blank" rel="noreferrer">
                        {r.payment_link_id}
                      </a>
                    )}
                  </td>
                  <td className="num">
                    {rupees(r.amount_paise)}
                    {r.order_amount_paise !== null &&
                      r.order_amount_paise !== r.amount_paise && (
                        <div className="mc-tiny">of {rupees(r.order_amount_paise)}</div>
                      )}
                  </td>
                  <td>
                    <span
                      className="mc-pill"
                      data-tone={
                        r.status === "paid"
                          ? "live"
                          : r.status === "awaiting_payment"
                            ? "paused"
                            : "blocked"
                      }
                    >
                      {r.status === "awaiting_payment" ? "awaiting" : r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ConsoleChrome>
  );
}
