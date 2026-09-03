"use client";

import { useState } from "react";

/**
 * Pause, resume, cancel.
 *
 * Pause is reversible and keeps the campaign's place and budget. Cancel is not:
 * it takes the campaign off the Live list for good and stops it suggesting or
 * spending, while leaving the sales it already made in the history — those
 * happened, and deleting them would be a lie about the store's revenue.
 */
export function RowControls({
  id,
  paused,
  ended,
  cancelled,
}: {
  id: string;
  paused: boolean;
  ended: boolean;
  cancelled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (cancelled) return <span className="mc-tiny">cancelled</span>;
  if (ended) return <span className="mc-tiny">ended</span>;

  async function send(payload: Record<string, unknown>): Promise<void> {
    setBusy(true);
    try {
      await fetch("/api/merchant/campaign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...payload }),
      });
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="cs-row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <span className="mc-tiny">Cancel for good?</span>
        <button className="mc-btn" disabled={busy} onClick={() => void send({ cancel: true })}>
          {busy ? "…" : "Yes"}
        </button>
        <button className="mc-btn mc-btn--quiet" disabled={busy} onClick={() => setConfirming(false)}>
          No
        </button>
      </div>
    );
  }

  return (
    <div className="cs-row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <button
        className="mc-btn mc-btn--quiet"
        disabled={busy}
        onClick={() => void send({ active: paused })}
      >
        {busy ? "…" : paused ? "Resume" : "Pause"}
      </button>
      <button className="mc-btn mc-btn--quiet" disabled={busy} onClick={() => setConfirming(true)}>
        Cancel
      </button>
    </div>
  );
}
