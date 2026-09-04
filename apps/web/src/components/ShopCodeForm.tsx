"use client";

import { useState } from "react";

/**
 * The one place a shop code is typed.
 *
 * Shared by the shop's own gate and by the assistant's blind state, because a
 * shopper who is told "enter a shop code first" should not then have to go
 * find the field on another page. One resolver, one error message, two places
 * it can appear.
 */
export function ShopCodeForm({ autoFocus = false }: { autoFocus?: boolean } = {}) {
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
    <div className="sc-field">
      <label className="st-label" htmlFor="shop-code">
        Shop code
      </label>
      <form
        className="sc-row"
        onSubmit={(e) => {
          e.preventDefault();
          void enter();
        }}
      >
        <input
          id="shop-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="BARON-SKIN"
          autoFocus={autoFocus}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : "shop-code-error"}
        />
        <button className="st-btn" disabled={busy} type="submit">
          {busy ? "…" : "Enter"}
        </button>
      </form>

      {/* Errors sit under the field they belong to, not floating above it. */}
      {error !== null && (
        <p className="st-fielderror" id="shop-code-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
