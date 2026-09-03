"use client";

import { useEffect, useState } from "react";
import { WALLET_JUDGE_NOTE } from "@/lib/copy";

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

  const field: React.CSSProperties = {
    font: "inherit",
    padding: "10px 12px",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius)",
    width: "100%",
  };

  if (card !== null) {
    return (
      <div className="nl-panel cs-stack" style={{ marginTop: "var(--space-3)" }}>
        <div style={{ fontSize: 24, letterSpacing: "0.08em" }}>{card.display}</div>
        <div className="nl-sub">{card.brand} · vaulted, not charged</div>
        <div className="st-note cs-stack" style={{ gap: 8 }}>
          <span>{truth}</span>
          <span className="st-muted" style={{ fontSize: 13 }}>
            {fine}
          </span>
        </div>
        <p className="nl-sub" style={{ margin: 0, fontStyle: "italic", lineHeight: 1.55 }}>
          {WALLET_JUDGE_NOTE}
        </p>
        <a className="nl-btn nl-btn--ghost" href="/cart" style={{ alignSelf: "start" }}>
          Go shopping
        </a>
      </div>
    );
  }

  return (
    <form
      className="nl-panel cs-stack"
      style={{ marginTop: "var(--space-3)" }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="cs-stack" style={{ gap: 4 }}>
        <span className="nl-sub">Card number</span>
        <input
          style={field}
          value={pan}
          onChange={(e) => setPan(e.target.value)}
          placeholder="card number"
          inputMode="numeric"
          autoComplete="off"
        />
      </label>

      <div className="cs-row" style={{ gap: "var(--space)" }}>
        <label className="cs-stack" style={{ gap: 4, flex: 1 }}>
          <span className="nl-sub">Expiry</span>
          <input
            style={field}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            placeholder="12/30"
            autoComplete="off"
          />
        </label>
        <label className="cs-stack" style={{ gap: 4, flex: 1 }}>
          <span className="nl-sub">CVV</span>
          <input
            style={field}
            value={cvv}
            onChange={(e) => setCvv(e.target.value)}
            placeholder="123"
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
      </div>

      <label className="cs-stack" style={{ gap: 4 }}>
        <span className="nl-sub">Name on card</span>
        <input
          style={field}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="A Shopper"
          autoComplete="off"
        />
      </label>

      {error !== null && <div className="nl-note" style={{ color: "var(--danger)" }}>{error}</div>}

      <button className="nl-btn" disabled={busy} type="submit" style={{ alignSelf: "start" }}>
        {busy ? "Saving…" : "Save card"}
      </button>

      <p className="nl-sub" style={{ margin: 0 }}>
        Demo only, Razorpay test mode — use {testCard}. The number and CVV are discarded the
        moment they arrive; only the last four digits, the brand and a token id are kept.
      </p>
    </form>
  );
}
