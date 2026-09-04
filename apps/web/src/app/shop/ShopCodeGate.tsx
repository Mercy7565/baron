"use client";

import { useState } from "react";

/**
 * The door into a merchant's shop.
 *
 * Baron is a platform, so a shopper does not simply arrive at a catalog: they
 * arrive at Baron and then name the shop they were given. The gate is what
 * makes that real rather than implied — without a valid code there is no
 * product grid to look at.
 */
export function ShopCodeGate() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shop/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(d.error ?? "That code did not work.");
        return;
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-card sc-gate">
      <h2 style={{ marginTop: 0 }}>Enter a shop code</h2>
      <p className="st-muted" style={{ margin: 0 }}>
        Merchants hand out a code once their catalog is live. Ask the shop you want to buy from, or
        use <code>BARON-SKIN</code> for the demo store.
      </p>

      <form
        className="sc-row"
        onSubmit={(e) => {
          e.preventDefault();
          void enter();
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="BARON-SKIN"
          aria-label="Shop code"
        />
        <button className="st-btn" disabled={busy} type="submit">
          {busy ? "…" : "Enter"}
        </button>
      </form>

      {error !== null && <p className="st-note" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
