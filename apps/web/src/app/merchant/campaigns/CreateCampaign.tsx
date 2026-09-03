"use client";

import { useState } from "react";

export interface SkuOption {
  id: string;
  title: string;
}

const TYPES = [
  ["bought_together", "Bought together"],
  ["save_more", "Add this to save more"],
  ["bogo", "Buy X get Y free"],
] as const;

const today = (): string => new Date().toISOString().slice(0, 10);
const inDays = (n: number): string =>
  new Date(Date.now() + n * 24 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * Create a campaign.
 *
 * A campaign says which products to suggest and how much may be spent doing it.
 * It never creates a coupon: the seven Razorpay coupons are fixed, and the
 * kernel picks which one attaches. The suggested percentage here is a ceiling
 * on what the store will ask for — policy can still grant less.
 */
export function CreateCampaign({ skus }: { skus: SkuOption[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("bought_together");
  const [triggers, setTriggers] = useState<string[]>([]);
  const [reward, setReward] = useState("");
  const [suggested, setSuggested] = useState("");
  const [budget, setBudget] = useState("2000");
  const [starts, setStarts] = useState(today());
  const [ends, setEnds] = useState(inDays(30));

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/merchant/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          kind,
          trigger_sku_ids: triggers,
          reward_sku_id: reward === "" ? null : reward,
          suggested_bps: suggested === "" ? 0 : Math.round(Number(suggested) * 100),
          budget_paise: Math.round(Number(budget) * 100),
          starts_at: new Date(`${starts}T00:00:00.000Z`).toISOString(),
          ends_at: new Date(`${ends}T23:59:59.000Z`).toISOString(),
        }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(d.error ?? "could not save that campaign");
        return;
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="mc-btn" style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
        Create campaign
      </button>
    );
  }

  return (
    <div className="mc-panel" style={{ marginBottom: 12 }}>
      <h2>Create campaign</h2>

      <div className="mc-form">
        <label>
          <span>Name</span>
          <input
            className="mc-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Serum pairing"
          />
        </label>

        <label>
          <span>Type</span>
          <select className="mc-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {TYPES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="mc-form-wide">
          <span>Trigger products — the campaign runs when one of these is in the basket</span>
          <select
            className="mc-input"
            multiple
            size={6}
            value={triggers}
            onChange={(e) =>
              setTriggers([...e.target.selectedOptions].map((o) => o.value))
            }
          >
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>

        <label className="mc-form-wide">
          <span>{kind === "bogo" ? "Free product" : "Product to suggest"}</span>
          <select className="mc-input" value={reward} onChange={(e) => setReward(e.target.value)}>
            <option value="">None</option>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Suggested % (cap only)</span>
          <input
            className="mc-input"
            type="number"
            min={0}
            max={25}
            value={suggested}
            onChange={(e) => setSuggested(e.target.value)}
            placeholder="optional"
          />
        </label>

        <label>
          <span>Budget ₹</span>
          <input
            className="mc-input"
            type="number"
            min={1}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </label>

        <label>
          <span>Starts</span>
          <input
            className="mc-input"
            type="date"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
          />
        </label>

        <label>
          <span>Ends</span>
          <input
            className="mc-input"
            type="date"
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
          />
        </label>
      </div>

      {error !== null && (
        <p className="mc-sub" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <p className="mc-sub">
        The suggested % is a ceiling. Baron still picks which of the 7 Razorpay coupons attaches,
        and may grant less.
      </p>

      <div className="cs-row" style={{ gap: 8 }}>
        <button className="mc-btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save campaign"}
        </button>
        <button className="mc-btn mc-btn--quiet" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
