"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Asks Razorpay whether any awaiting link has actually been paid.
 *
 * Runs once automatically when the page opens, so a shopper who has just paid
 * on Razorpay comes back to a page that already knows. The button stays for the
 * case where they return before Razorpay has recorded it.
 */
export function RefreshOrders({ label, auto = false }: { label: string; auto?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ranAuto = useRef(false);

  async function check(silent = false): Promise<boolean> {
    setBusy(true);
    if (!silent) setNote(null);
    try {
      const r = await fetch("/api/orders/refresh", { method: "POST" });
      if (!r.ok) return false;

      const d = (await r.json()) as { checked?: number; now_paid?: number };
      if ((d.now_paid ?? 0) > 0) {
        window.location.reload();
        return true;
      }
      if (!silent) {
        setNote(
          (d.checked ?? 0) === 0
            ? "Nothing waiting on payment."
            : "Razorpay has not recorded a payment on that link yet.",
        );
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // Once per mount, quietly. A second check is the button.
    if (!auto || ranAuto.current) return;
    ranAuto.current = true;
    void check(true);
  }, [auto]);

  return (
    <span>
      <button className="st-btn st-btn--quiet" disabled={busy} onClick={() => void check()}>
        {busy ? "Checking…" : label}
      </button>
      {note !== null && (
        <span className="st-muted" style={{ fontSize: 14, marginLeft: 12 }}>
          {note}
        </span>
      )}
    </span>
  );
}
