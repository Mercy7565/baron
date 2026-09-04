"use client";

import { useState } from "react";

/**
 * Leave the shop you are in.
 *
 * A shopper on Baron is inside one merchant at a time, and there was no way
 * back out — once a code was accepted the catalog stayed for a week, so trying
 * a second shop meant clearing a cookie by hand. This drops the code and
 * returns to the gate, where another one can be typed.
 *
 * It does not sign anyone out: the account and the basket are the shopper's,
 * the code is only which shelf they are standing in front of.
 */
export function ExitShop({ code }: { code: string }) {
  const [busy, setBusy] = useState(false);

  async function leave(): Promise<void> {
    setBusy(true);
    try {
      await fetch("/api/shop/code", { method: "DELETE" });
      window.location.href = "/shop";
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sc-bar">
      <span className="st-muted">
        You are shopping <strong className="mono">{code}</strong>
      </span>
      <button className="st-btn st-btn--quiet" disabled={busy} onClick={() => void leave()}>
        {busy ? "Leaving…" : "Exit shop"}
      </button>
    </div>
  );
}
