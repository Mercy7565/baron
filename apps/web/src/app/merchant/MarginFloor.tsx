"use client";

import { useEffect, useState } from "react";

export interface FloorSample {
  label: string;
  subtotal_paise: number;
  margin_bps: number;
}

/** Where the "I have read these" preference lives. */
const EXAMPLES_KEY = "baron.merchant.floorExamples";

const rupees = (paise: number): string => `₹${(paise / 100).toLocaleString("en-IN")}`;

/**
 * The margin floor, as a control rather than a constant.
 *
 * This is the number that decides whether the seven-coupon ladder can be
 * climbed at all. At the old 48% almost every basket cleared 2% and no more,
 * and a merchant watching that had no way to do anything about it. The helper
 * text recomputes against real baskets as the slider moves, so the trade-off is
 * visible before anything is saved: raise the floor and coupons disappear.
 */
export function MarginFloor({
  initialBps,
  defaultBps,
  ladder,
  samples,
}: {
  initialBps: number;
  defaultBps: number;
  ladder: Array<{ discount_bps: number; min_cart_paise: number }>;
  samples: FloorSample[];
}) {
  const [bps, setBps] = useState(initialBps);
  const [saved, setSaved] = useState(initialBps);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(true);

  /**
   * Whether this merchant wants the worked examples.
   *
   * They are help text for the slider and nothing else — no cart is ever loaded
   * from these rows — so a merchant who has understood the trade-off should be
   * able to put them away for good. Kept in localStorage rather than the
   * overlay because it is a preference about this person's screen, not a fact
   * about the store, and it must survive a refresh.
   */
  useEffect(() => {
    try {
      setShowExamples(window.localStorage.getItem(EXAMPLES_KEY) !== "hidden");
    } catch {
      // Private mode, or storage blocked. Showing them is the safe default.
    }
  }, []);

  function hideExamples(hide: boolean): void {
    setShowExamples(!hide);
    try {
      if (hide) window.localStorage.setItem(EXAMPLES_KEY, "hidden");
      else window.localStorage.removeItem(EXAMPLES_KEY);
    } catch {
      // A preference that cannot be saved is still a preference for this visit.
    }
  }

  /** The same three gates the kernel applies, so this preview cannot lie. */
  const clearable = (subtotal: number, margin: number): number => {
    let best = 0;
    for (const r of ladder) {
      if (subtotal < r.min_cart_paise) continue;
      if (margin - r.discount_bps < bps) continue;
      if (r.discount_bps > best) best = r.discount_bps;
    }
    return best;
  };

  async function save(): Promise<void> {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/merchant/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ margin_floor_bps: bps }),
      });
      const d = (await res.json()) as { margin_floor_bps?: number; error?: string };
      if (!res.ok || typeof d.margin_floor_bps !== "number") {
        setNote(d.error ?? "could not save that floor");
        return;
      }
      setBps(d.margin_floor_bps);
      setSaved(d.margin_floor_bps);
      setNote("Saved. The next quote uses this floor.");
    } finally {
      setBusy(false);
    }
  }

  const dirty = bps !== saved;

  return (
    <div className="mc-panel" style={{ marginBottom: 12 }}>
      <h2>Minimum margin to protect</h2>
      <p className="mc-sub" style={{ marginTop: 0 }}>
        No coupon may take post-discount margin below this. It is the single number that decides
        how far up the coupon ladder a basket can reach.
      </p>

      <div className="mc-floor">
        <input
          type="range"
          min={0}
          max={4000}
          step={100}
          value={bps}
          onChange={(e) => setBps(Number(e.target.value))}
          aria-label="Minimum margin to protect, in percent"
        />
        <output className="mc-floor-value">{bps / 100}%</output>
        <button className="mc-btn" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : dirty ? "Save floor" : "Saved"}
        </button>
        {bps !== defaultBps && (
          <button
            className="mc-btn mc-btn--quiet"
            disabled={busy}
            onClick={() => setBps(defaultBps)}
          >
            Reset to {defaultBps / 100}%
          </button>
        )}
      </div>

      {showExamples ? (
        <div className="mc-examples">
          {/* Above the table, in the card's own padding. It used to be absolutely
              positioned over the top-right corner, where it landed on the
              "Best coupon at 15%" column header. */}
          <div className="mc-examples-head">
            <span className="mc-tiny">Examples only — they show how this floor changes coupons.</span>
            <button
              className="mc-examples-x"
              aria-label="Hide the examples"
              title="Hide the examples"
              onClick={() => hideExamples(true)}
            >
              ×
            </button>
          </div>

          <table className="mc-table">
            <thead>
              <tr>
                <th>A basket like this</th>
                <th className="num">Total</th>
                <th className="num">Margin</th>
                <th className="num">Best coupon at {bps / 100}%</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => {
                const best = clearable(s.subtotal_paise, s.margin_bps);
                return (
                  <tr key={s.label}>
                    <td>{s.label}</td>
                    <td className="num">{rupees(s.subtotal_paise)}</td>
                    <td className="num">{s.margin_bps / 100}%</td>
                    <td className="num">
                      <strong style={{ color: best === 0 ? "var(--danger)" : "var(--ok)" }}>
                        {best === 0 ? "none" : `${best / 100}%`}
                      </strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mc-sub" style={{ margin: "10px 0 0" }}>
          <button className="mc-linkbtn" onClick={() => hideExamples(false)}>
            Show examples
          </button>
        </p>
      )}

      <p className="mc-sub" style={{ marginBottom: 0 }}>
        {note ??
          (dirty
            ? "Drag to see the effect, then save. Nothing changes until you do."
            : "A higher floor protects margin and refuses more coupons. A lower floor lets bigger coupons through on the same baskets.")}
      </p>
    </div>
  );
}
