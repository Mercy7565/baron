"use client";

import { Fragment, useState } from "react";

import type { LedgerRow } from "@/server/ledger-rows";

/**
 * The money ledger, as a table a person can actually read.
 *
 * It used to render the audit log as JSON, which is honest but unusable: a
 * merchant asking "why did that customer get 5% and not 15%" should not have to
 * parse a hash chain to find out. Every column here is a question someone has
 * actually asked, the expander answers "why" in a sentence, and the copy and
 * print actions exist because the moment this matters is a dispute — and a
 * dispute needs the decision id and the hashes, not a screenshot.
 */
export function LedgerTable({
  rows,
  why,
  text,
  coupon,
  pageText,
}: {
  rows: LedgerRow[];
  why: Record<string, string>;
  text: Record<string, string>;
  /** offer id rendered as its coupon percentage, keyed by row. */
  coupon: Record<string, string>;
  pageText: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  function toggle(key: string): void {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function copy(what: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1600);
    } catch {
      setCopied("failed");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="mc-empty">
        No payments yet. Rows are only succeeded payments — a basket that was priced but not paid
        stays on the customer&rsquo;s unpaid list until they pay or close it.
      </div>
    );
  }

  return (
    <>
      <div className="mc-actions no-print">
        <button className="mc-btn mc-btn--quiet" onClick={() => void copy("page", pageText)}>
          {copied === "page" ? "Copied" : "Copy page"}
        </button>
        <button className="mc-btn mc-btn--quiet" onClick={() => window.print()}>
          Print
        </button>
        {copied === "failed" && (
          <span className="mc-sub" style={{ margin: 0 }}>
            The browser refused clipboard access — use Print instead.
          </span>
        )}
      </div>

      <table className="mc-table mc-ledger">
        <thead>
          <tr>
            <th>Time</th>
            <th>Who</th>
            <th>Asked for</th>
            <th>We found</th>
            <th>Campaign</th>
            <th>Upsell</th>
            <th className="num">Coupon</th>
            <th>Offer</th>
            <th>Outcome</th>
            <th className="no-print" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.key);
            return (
              <Fragment key={r.key}>
                <tr className="mc-ledger-row" onClick={() => toggle(r.key)}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Date(r.ts).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>
                    <span className="mc-pill" data-tone={r.actor_kind === "agent" ? "paused" : undefined}>
                      {r.actor_kind}
                    </span>
                    <div className="mc-tiny">{r.actor}</div>
                  </td>
                  <td style={{ maxWidth: 190 }}>{r.asked}</td>
                  <td style={{ maxWidth: 220 }}>{r.found}</td>
                  <td>{r.campaign ?? <span className="mc-tiny">none</span>}</td>
                  <td>
                    {r.upsell_accepted === null ? (
                      <span className="mc-tiny">not offered</span>
                    ) : (
                      <span className="mc-pill" data-tone={r.upsell_accepted ? "live" : "paused"}>
                        {r.upsell_accepted ? "accepted" : "declined"}
                      </span>
                    )}
                  </td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    <strong>
                      {r.asked_bps / 100}% → {r.applied_bps / 100}%
                    </strong>
                    <div className="mc-tiny">
                      ₹{(r.subtotal_paise / 100).toFixed(2)} → ₹{(r.total_paise / 100).toFixed(2)}
                    </div>
                  </td>
                  <td>
                    {r.offer_id === null ? (
                      <span className="mc-tiny">none</span>
                    ) : (
                      <>
                        <span
                          className="mc-pill"
                          data-tone={r.attached === false ? "blocked" : "live"}
                        >
                          {/* The pill names the coupon, not our bookkeeping. A row
                              on this page is a payment, so the coupon on it is the
                              one the buyer actually got. */}
                          {coupon[r.key] ?? "coupon"}
                          {r.attached === false ? " · not attached" : ""}
                        </span>
                        <div className="mc-tiny mono">{r.offer_id}</div>
                      </>
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
                      {r.outcome}
                    </span>
                    {r.payment_id !== null && <div className="mc-tiny mono">{r.payment_id}</div>}
                  </td>
                  <td className="no-print">
                    <button
                      className="mc-btn mc-btn--quiet"
                      onClick={(e) => {
                        e.stopPropagation();
                        void copy(r.key, text[r.key] ?? "");
                      }}
                    >
                      {copied === r.key ? "Copied" : "Copy row"}
                    </button>
                  </td>
                </tr>

                {/* Always in the DOM for print; only shown on screen when opened. */}
                <tr
                  className="mc-why-row"
                  data-open={isOpen ? "yes" : "no"}
                >
                  <td colSpan={10}>
                    <p className="mc-why">{why[r.key]}</p>
                    <p className="mc-tiny mono mc-ids">
                      decision {r.decision_id ?? "—"} · quote {r.quote_id} · chain #{r.seq ?? "—"} ·
                      hash {r.hash === null ? "—" : `${r.hash.slice(0, 16)}…`}
                    </p>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
