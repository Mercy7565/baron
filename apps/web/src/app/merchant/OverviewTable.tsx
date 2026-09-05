"use client";

export interface OverviewRow {
  key: string;
  ts: string;
  subtotal_paise: number;
  who: string;
  who_kind: "customer" | "agent";
  campaign: string | null;
  asked_bps: number;
  applied_bps: number;
  cause: string;
  offer_id: string | null;
  attached: boolean | null;
  /** The coupon percentage behind offer_id, e.g. "15%". */
  coupon: string | null;
  outcome: string;

  /**
   * False when Razorpay reports the payment but our own log no longer holds the
   * decision. Such a row shows what was charged and refuses to show an ask or a
   * verdict it cannot evidence.
   */
  verdict_known: boolean;
  captured_paise: number | null;
  payment_id: string | null;
  payment_link_id: string | null;
  shop_code: string | null;
}

const rupees = (paise: number): string => `₹${(paise / 100).toLocaleString("en-IN")}`;

/**
 * The one merchant table.
 *
 * This replaced two panels that each told half a story: "Last five money
 * decisions", which said CLAMP on almost every row because the shop asked a
 * flat 15% of every basket, and "Where the discounts actually landed", which
 * only listed clamps and so could never show a decision that went well.
 *
 * Every row here is a payment. A priced basket nobody paid for is not a money
 * decision a merchant needs on their front page — it is on the customer's
 * unpaid list, where someone can still act on it.
 */
export function OverviewTable({ rows }: { rows: OverviewRow[] }) {
  return (
    <>
      <div className="mc-panel" style={{ marginBottom: 12 }}>
        <h2>Every money decision</h2>
        <p className="mc-sub" style={{ marginTop: 0 }}>
          Showing only top 5. Purchases customers actually paid for — what the basket was, who
          drove it, what was asked for, what was allowed, and the reason for the difference.
        </p>

        {rows.length === 0 ? (
          <div className="mc-empty">
            No paid purchases yet. A basket that was priced but not paid stays on the
            customer&rsquo;s unpaid list until they pay it.
          </div>
        ) : (
          <table className="mc-table mc-decisions">
            <thead>
              <tr>
                <th>When</th>
                <th className="num">Basket</th>
                <th>Who</th>
                <th className="num">Wanted</th>
                <th className="num">Allowed</th>
                <th>Why</th>
                <th>Offer</th>
                <th>Payment</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Date(r.ts).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="num">{rupees(r.subtotal_paise)}</td>
                  <td>
                    {r.campaign ?? r.who}
                    <div className="mc-tiny">
                      {r.shop_code ?? (r.campaign === null ? r.who_kind : `${r.who_kind} · ${r.who}`)}
                    </div>
                  </td>
                  {/* A dash, not a zero. "0%" is a claim that nothing was
                      asked for; this row simply does not know. */}
                  <td className="num">{r.verdict_known ? `${r.asked_bps / 100}%` : "—"}</td>
                  <td className="num">
                    {r.verdict_known || r.applied_bps > 0 ? (
                      <strong>{r.applied_bps / 100}%</strong>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={{ maxWidth: 330 }}>{r.cause}</td>
                  <td>
                    {r.offer_id === null ? (
                      <span className="mc-tiny">none</span>
                    ) : (
                      <>
                        <span
                          className="mc-pill"
                          data-tone={r.attached === false ? "blocked" : "live"}
                        >
                          {/* Paid rows only, so the coupon the buyer got is the
                              honest label. "unknown" described our bookkeeping,
                              not their purchase. */}
                          {r.coupon ?? "coupon"}
                          {r.attached === false ? " · not attached" : ""}
                        </span>
                        <div className="mc-tiny mono">{r.offer_id}</div>
                      </>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {r.payment_id ?? r.payment_link_id ?? "—"}
                    {r.captured_paise !== null && (
                      <div className="mc-tiny">{rupees(r.captured_paise)} captured</div>
                    )}
                  </td>
                  <td>
                    <span
                      className="mc-pill"
                      data-tone={
                        r.outcome === "paid"
                          ? "live"
                          : r.outcome === "closed"
                            ? "blocked"
                            : r.outcome === "link"
                              ? "paused"
                              : undefined
                      }
                    >
                      {r.outcome === "no link" ? "quote" : r.outcome === "link" ? "link issued" : r.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>

    </>
  );
}
