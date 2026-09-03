import { explainOrder, ordersByStatus } from "@countersign/orders";

import { ConsoleChrome } from "@/components/ConsoleChrome";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rupees = (paise: number): string => `₹${(paise / 100).toLocaleString("en-IN")}`;

export default async function MerchantOrders({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const showing: "paid" | "awaiting_payment" | "closed" =
    tab === "awaiting" ? "awaiting_payment" : tab === "closed" ? "closed" : "paid";

  const paid = ordersByStatus("paid");
  const awaiting = ordersByStatus("awaiting_payment");
  // A link the buyer closed. It leaves Awaiting the moment they close it, so
  // the pipeline number stops counting money that is not coming.
  const closed = ordersByStatus("closed");
  const rows = showing === "paid" ? paid : showing === "closed" ? closed : awaiting;

  const revenue = paid.reduce((n, o) => n + o.amount_paise, 0);
  const pipeline = awaiting.reduce((n, o) => n + o.amount_paise, 0);

  return (
    <ConsoleChrome current="/merchant/orders">
      <h1>Orders</h1>
      <p className="mc-sub">
        Paid and awaiting are kept apart on purpose. An issued Payment Link is not revenue until
        Razorpay reports a payment against it.
      </p>

      <div className="mc-grid" style={{ marginBottom: 12 }}>
        <div className="mc-stat">
          <div className="v" style={{ color: "var(--ok)" }}>
            {rupees(revenue)}
          </div>
          <div className="k">collected · {paid.length} paid</div>
        </div>
        <div className="mc-stat">
          <div className="v" style={{ color: "var(--muted)" }}>
            {rupees(pipeline)}
          </div>
          <div className="k">awaiting payment · {awaiting.length} links</div>
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
          Closed ({closed.length})
        </a>
      </div>

      <div className="mc-panel">
        {rows.length === 0 ? (
          <div className="mc-empty">
            {showing === "paid"
              ? "No payments collected yet. A link becomes an order here once Razorpay confirms it."
              : showing === "closed"
                ? "No links have been closed. A buyer who walks away from a link closes it, and it lands here."
                : "No links awaiting payment."}
          </div>
        ) : (
          <table className="mc-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Items</th>
                <th className="num">Asked</th>
                <th className="num">Applied</th>
                <th>Offer</th>
                <th>Payment link</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.order_id} title={explainOrder(o)}>
                  <td style={{ color: "var(--muted)" }}>{o.order_id.slice(0, 14)}…</td>
                  <td>{o.lines.map((l) => `${l.title} ×${l.qty}`).join(", ")}
                    {(o.gift_lines ?? []).map((g) => (
                      <div key={g.sku_id} className="mc-tiny">
                        {g.title} × {g.qty} — free with {g.from_campaign_id ?? "a campaign"}
                      </div>
                    ))}</td>
                  <td className="num">{o.asked_bps / 100}%</td>
                  <td className="num">{o.applied_bps / 100}%</td>
                  <td>{o.offer_id ?? "—"}</td>
                  <td>
                    <a href={o.short_url} target="_blank" rel="noreferrer">
                      {o.payment_link_id.slice(0, 16)}…
                    </a>
                  </td>
                  <td className="num">{rupees(o.amount_paise)}</td>
                  <td>
                    <span
                      className="mc-pill"
                      data-tone={
                        o.status === "paid" ? "live" : o.status === "closed" ? "blocked" : "paused"
                      }
                    >
                      {o.status === "paid" ? "paid" : o.status === "closed" ? "closed" : "awaiting"}
                    </span>
                    {o.status === "closed" && o.cancelled_at_razorpay === false && (
                      <div style={{ color: "var(--muted)", fontSize: 11.5 }}>
                        closed here only — Razorpay refused the cancel
                      </div>
                    )}
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
