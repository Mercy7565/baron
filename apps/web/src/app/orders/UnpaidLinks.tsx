"use client";

import { useState } from "react";

export interface UnpaidRow {
  order_id: string;
  short_url: string;
  amount_paise: number;
  created_at: string;
  summary: string;
}

const rupees = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;

/**
 * The links a buyer has been handed but not paid.
 *
 * These are not orders and are deliberately not shown as such — an issued link
 * is an invitation to pay, and it stays on this tab until Razorpay says it was
 * paid. Two things a buyer can do with one: open it, or close it. Closing asks
 * Razorpay to cancel the link so the URL genuinely stops working; if Razorpay
 * refuses, the row is closed here anyway and the response says so, because a
 * buyer who has walked away should not keep seeing it either way.
 */
export interface PendingQuote {
  quote_id: string;
  summary: string;
  total_paise: number;
  applied_bps: number;
  offer_id: string | null;
  created_at: string;
}

/** The promise that has to appear under every generate button, unchanged. */
const S2S_NOTE =
  "When server-to-server card charge is enabled on this account, the agent will pay with the saved card. You will not need to generate a link or pay on Razorpay yourself.";

export function UnpaidLinks({
  rows,
  pending = [],
}: {
  rows: UnpaidRow[];
  pending?: PendingQuote[];
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(new Set());

  const visible = rows.filter((r) => !closed.has(r.order_id));
  const waiting = pending.filter((q) => !done.has(q.quote_id));

  /**
   * Generate the Payment Link for a quote. This click is the only thing in the
   * product that creates one — quoting is free, a link is a real object in a
   * real Razorpay account. A second click returns the same link, because
   * issuing is idempotent on the quote.
   */
  async function generate(quoteId: string): Promise<void> {
    setBusy(quoteId);
    setError(null);
    try {
      const res = await fetch("/api/checkout/issue-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quote_id: quoteId, presence: "hitl" }),
      });
      const d = (await res.json()) as {
        short_url?: string;
        razorpay_error?: string;
        reason?: string;
        error?: string;
      };

      if (!res.ok || typeof d.short_url !== "string") {
        setError(String(d.razorpay_error ?? d.reason ?? d.error ?? "could not generate a link"));
        return;
      }
      setMade((m) => ({ ...m, [quoteId]: d.short_url as string }));
      setDone((s) => new Set(s).add(quoteId));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Decline a price before any link exists. Creates nothing, cancels nothing at
   * Razorpay — there is nothing there yet — and just takes the row off this
   * list. Distinct from closing a link, which does call Razorpay.
   */
  async function closeQuote(quoteId: string): Promise<void> {
    setBusy(quoteId);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(quoteId)}/cancel`, {
        method: "POST",
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(d.error ?? "could not close that quote");
        return;
      }
      setDone((s) => new Set(s).add(quoteId));
    } finally {
      setBusy(null);
    }
  }

  async function close(orderId: string): Promise<void> {
    setBusy(orderId);
    setError(null);
    try {
      const res = await fetch("/api/orders/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      const d = (await res.json()) as { error?: string };

      if (!res.ok) {
        setError(d.error ?? "could not close that link");
        return;
      }
      setClosed((s) => new Set(s).add(orderId));
    } finally {
      setBusy(null);
    }
  }

  if (visible.length === 0 && waiting.length === 0 && Object.keys(made).length === 0) {
    return (
      <div className="st-card" style={{ textAlign: "center", padding: 40 }}>
        <p style={{ margin: "0 0 6px", fontSize: 17 }}>No unpaid links.</p>
        <p className="st-muted" style={{ margin: 0 }}>
          Ask the agent for something and it will hand you a payment link.
        </p>
      </div>
    );
  }

  return (
    <>
      {error !== null && (
        <div className="st-note" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        {waiting.map((q) => (
          <div key={q.quote_id} className="st-card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 16,
              }}
            >
              <div>
                <div style={{ fontSize: 17 }}>{q.summary}</div>
                <div className="st-muted" style={{ fontSize: 14, marginTop: 4 }}>
                  {q.applied_bps === 0
                    ? "No coupon applies to this basket."
                    : `${q.applied_bps / 100}% coupon allowed${q.offer_id === null ? "" : ` · ${q.offer_id}`}`}
                </div>
              </div>
              <strong className="nl-money" style={{ fontSize: 19 }}>
                {rupees(q.total_paise)}
              </strong>
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="st-btn"
                disabled={busy === q.quote_id}
                onClick={() => void generate(q.quote_id)}
              >
                {busy === q.quote_id ? "Generating…" : "Generate payment link"}
              </button>
              <button
                className="st-btn st-btn--quiet"
                disabled={busy === q.quote_id}
                onClick={() => void closeQuote(q.quote_id)}
              >
                Close quote
              </button>
            </div>
            <p className="st-muted" style={{ fontSize: 13.5, fontStyle: "italic", margin: "10px 0 0" }}>
              {S2S_NOTE}
            </p>
          </div>
        ))}

        {Object.entries(made).map(([quoteId, url]) => (
          <div key={quoteId} className="st-card">
            <div style={{ fontSize: 17 }}>Payment link ready</div>
            <a
              className="mono"
              href={url}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-block", margin: "10px 0 14px", fontSize: 13 }}
            >
              {url}
            </a>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a className="st-btn" href={url} target="_blank" rel="noreferrer">
                Open link
              </a>
              <a className="st-btn st-btn--quiet" href="/orders?tab=unpaid">
                Refresh this list
              </a>
            </div>
          </div>
        ))}

        {visible.map((r) => (
          <div key={r.order_id} className="st-card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 16,
              }}
            >
              <div>
                <div style={{ fontSize: 17 }}>{r.summary}</div>
                <div className="st-muted" style={{ fontSize: 14, marginTop: 4 }}>
                  Link issued {r.created_at.slice(0, 10)} · not paid yet
                </div>
              </div>
              <strong className="nl-money" style={{ fontSize: 19 }}>
                {rupees(r.amount_paise)}
              </strong>
            </div>

            <a
              className="mono"
              href={r.short_url}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-block", margin: "12px 0 14px", fontSize: 13 }}
            >
              {r.short_url}
            </a>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a className="st-btn" href={r.short_url} target="_blank" rel="noreferrer">
                Open link
              </a>
              <button
                className="st-btn st-btn--quiet"
                disabled={busy === r.order_id}
                onClick={() => void close(r.order_id)}
              >
                {busy === r.order_id ? "Closing…" : "Close"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="st-muted" style={{ fontSize: 14, marginTop: 16 }}>
        Paying one of these moves it to Paid — but only after Razorpay confirms it. Closing one
        cancels the link and removes it from this list.
      </p>
    </>
  );
}
