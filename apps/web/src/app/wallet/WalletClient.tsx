"use client";

import { useEffect, useState } from "react";
import { WALLET_NOTE } from "@/lib/copy";

interface CardOnFile {
  display: string;
  brand: string;
}

/**
 * The card form.
 *
 * The PAN and CVV live in component state only long enough to be posted, and
 * are cleared the moment the vault answers. Nothing here writes to
 * localStorage — a saved card is server-side state, and the browser keeps no
 * copy of the number.
 */
export function WalletClient({
  testCard,
  truth,
  fine,
}: {
  testCard: string;
  truth: string;
  fine: string;
}) {
  const [pan, setPan] = useState("");
  const [cvv, setCvv] = useState("");
  const [expiry, setExpiry] = useState("");
  const [name, setName] = useState("");
  const [card, setCard] = useState<CardOnFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/wallet")
      .then((r) => r.json())
      .then((d: { card: CardOnFile | null }) => setCard(d.card));
  }, []);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pan, cvv, expiry, name }),
      });
      const d = (await r.json()) as { ok: boolean; card?: CardOnFile; error?: string };

      // Cleared immediately, success or failure.
      setPan("");
      setCvv("");

      if (d.ok && d.card !== undefined) setCard(d.card);
      else setError(d.error ?? "Could not save that card.");
    } finally {
      setBusy(false);
    }
  }

  if (card !== null) {
    return (
      <div className="st-card wl-card">
        <div className="wl-pan mono">{card.display}</div>
        <div className="st-muted">{card.brand} · vaulted, not charged</div>
        <div className="st-note">
          <p style={{ margin: 0 }}>{truth}</p>
          <p className="st-muted" style={{ margin: "6px 0 0" }}>
            {fine}
          </p>
        </div>
        <p className="page-help">{WALLET_NOTE}</p>
        <a className="st-btn st-btn--quiet ag-selfstart" href="/shop">
          Go shopping
        </a>
      </div>
    );
  }

  return (
    <form
      className="st-card st-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="st-field st-field--wide">
        <span className="st-label">Card number</span>
        <input
          value={pan}
          onChange={(e) => setPan(e.target.value)}
          placeholder="4111 1111 1111 1111"
          inputMode="numeric"
          autoComplete="off"
        />
      </label>

      <label className="st-field">
        <span className="st-label">Expiry</span>
        <input
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          placeholder="12/30"
          autoComplete="off"
        />
      </label>

      <label className="st-field">
        <span className="st-label">CVV</span>
        <input
          value={cvv}
          onChange={(e) => setCvv(e.target.value)}
          placeholder="123"
          inputMode="numeric"
          autoComplete="off"
        />
      </label>

      <label className="st-field st-field--wide">
        <span className="st-label">Name on card</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="A Shopper"
          autoComplete="off"
        />
      </label>

      {/* The error belongs under the fields it is about, not above them. */}
      {error !== null && (
        <p className="st-fielderror st-field--wide" role="alert">
          {error}
        </p>
      )}

      <div className="st-field--wide">
        <button className="st-btn" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save card"}
        </button>
      </div>

      <p className="st-muted st-field--wide" style={{ margin: 0 }}>
        Demo only, Razorpay test mode — use {testCard}. The number and CVV are discarded the
        moment they arrive; only the last four digits, the brand and a token id are kept.
      </p>
    </form>
  );
}
