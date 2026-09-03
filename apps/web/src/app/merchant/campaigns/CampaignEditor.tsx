"use client";

import { useState } from "react";

export interface CampaignRow {
  id: string;
  name: string;
  state: "live" | "paused" | "expired";
  active: boolean;
  hint_bps: number;
  spend_ceiling_paise: number;
  spent_paise: number;
  applied_bps: number[];
}

const rupees = (paise: number): string => `₹${(paise / 100).toLocaleString("en-IN")}`;

/**
 * Budgets, not promises. A merchant sets a ceiling and a pause switch; what the
 * kernel actually applied is shown beside the hint so the gap is visible.
 */
export function CampaignEditor({ rows }: { rows: CampaignRow[] }) {
  const [ceilings, setCeilings] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.spend_ceiling_paise])),
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function save(id: string, patch: { spend_ceiling_paise?: number; active?: boolean }): Promise<void> {
    setBusy(id);
    try {
      await fetch("/api/merchant/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaign_id: id, ...patch }),
      });
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mc-panel">
      <table className="mc-table">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>State</th>
            <th className="num">Hint</th>
            <th className="num">Kernel applied</th>
            <th className="num">Ceiling (paise)</th>
            <th style={{ width: 190 }}>Spent / remaining</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ceiling = ceilings[r.id] ?? r.spend_ceiling_paise;
            const remaining = Math.max(0, ceiling - r.spent_paise);
            const pct = ceiling === 0 ? 100 : Math.min(100, Math.round((r.spent_paise / ceiling) * 100));
            const exhausted = remaining === 0;

            return (
              <tr key={r.id}>
                <td>
                  {r.name}
                  <div style={{ color: "var(--muted)", fontSize: 11.5 }}>{r.id}</div>
                </td>
                <td>
                  <span className="mc-pill" data-tone={r.state}>
                    {r.state}
                  </span>
                </td>
                <td className="num">{r.hint_bps / 100}%</td>
                <td className="num">
                  {r.applied_bps.length === 0
                    ? "—"
                    : [...new Set(r.applied_bps)].map((b) => `${b / 100}%`).join(", ")}
                </td>
                <td className="num" style={{ width: 132 }}>
                  <input
                    className="mc-input"
                    style={{ textAlign: "right" }}
                    value={ceiling}
                    inputMode="numeric"
                    onChange={(e) =>
                      setCeilings((c) => ({ ...c, [r.id]: Number(e.target.value) || 0 }))
                    }
                  />
                </td>
                <td>
                  {/* green healthy, amber running low, rust spent */}
                  <div
                    className="mc-meter"
                    data-blocked={exhausted}
                    data-tone={exhausted ? "spent" : pct >= 80 ? "low" : undefined}
                  >
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
                    {rupees(r.spent_paise)} spent · {rupees(remaining)} left
                  </div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    className="mc-btn"
                    disabled={busy === r.id || ceiling === r.spend_ceiling_paise}
                    onClick={() => void save(r.id, { spend_ceiling_paise: ceiling })}
                  >
                    Save
                  </button>{" "}
                  <button
                    className="mc-btn mc-btn--quiet"
                    disabled={busy === r.id}
                    onClick={() => void save(r.id, { active: !r.active })}
                  >
                    {r.active ? "Pause" : "Resume"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
