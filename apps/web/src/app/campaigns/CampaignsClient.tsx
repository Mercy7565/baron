"use client";

import { useEffect, useState } from "react";

import { CampaignChip } from "@/components/CampaignChip";

interface CampaignRow {
  id: string;
  name: string;
  window_start: string;
  window_end: string;
  intent: string;
  max_discount_bps_hint: number;
  active: boolean;
  in_window: boolean;
}

interface AuditRow {
  seq: number;
  ts: string;
  decision_id: string | null;
  verdict: string;
  offer_id: string | null;
}

export function CampaignsClient() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [recent, setRecent] = useState<AuditRow[]>([]);

  async function refresh(): Promise<void> {
    const r = await fetch("/api/campaigns");
    setRows(((await r.json()) as { campaigns: CampaignRow[] }).campaigns);
    const a = await fetch("/api/audit/recent");
    if (a.ok) setRecent(((await a.json()) as { records: AuditRow[] }).records);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function toggle(id: string, active: boolean): Promise<void> {
    await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, active }),
    });
    await refresh();
  }

  return (
    <>
      <div className="cs-stack">
        {rows.map((c) => (
          <div key={c.id} className="cs-card cs-row" style={{ justifyContent: "space-between" }}>
            <div className="cs-stack" style={{ gap: 2 }}>
              <CampaignChip id={c.id} name={c.name} active={c.active} inWindow={c.in_window} />
              <span className="cs-muted mono" style={{ fontSize: 12 }}>
                {c.id} · intent {c.intent} · hint {c.max_discount_bps_hint} bps
              </span>
              <span className="cs-muted" style={{ fontSize: 12 }}>
                window {c.window_start.slice(0, 10)} → {c.window_end.slice(0, 10)}
                {c.in_window ? "" : " (outside window — ignored)"}
              </span>
            </div>
            <button className="cs-button" onClick={() => void toggle(c.id, !c.active)}>
              {c.active ? "disable" : "enable"}
            </button>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: "var(--space-3)" }}>Last 5 decisions</h2>
      {recent.length === 0 ? (
        <p className="cs-muted">No decisions yet. Propose from /cart.</p>
      ) : (
        <table className="cs-table">
          <thead>
            <tr>
              <th>seq</th>
              <th>ts</th>
              <th>decision_id</th>
              <th>verdict</th>
              <th>offer_id</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.seq}>
                <td>{r.seq}</td>
                <td>{r.ts}</td>
                <td>{r.decision_id ?? "—"}</td>
                <td>{r.verdict}</td>
                <td>{r.offer_id ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
