export interface TranscriptEntry {
  role: "user" | "agent" | "tool";
  /** Tool name when role is "tool". */
  tool?: string;
  text: string;
  /** Compact JSON shown under a tool call. */
  data?: unknown;
}

/**
 * Shows the agent's reasoning as a sequence of tool calls, not prose. A judge
 * needs to see that the agent proposed and the kernel disposed.
 */
export function AgentTranscript({ entries }: { entries: TranscriptEntry[] }) {
  return (
    <div className="cs-stack" role="log" aria-label="agent transcript">
      {entries.map((e, i) => (
        <div key={i} className="cs-card" data-role={e.role}>
          <div className="cs-muted mono" style={{ fontSize: 11, textTransform: "uppercase" }}>
            {e.role === "tool" ? `tool · ${e.tool ?? "?"}` : e.role}
          </div>
          <div style={{ fontSize: 14 }}>{e.text}</div>
          {e.data !== undefined && (
            <pre style={{ fontSize: 11, marginTop: 8 }}>{JSON.stringify(e.data, null, 2)}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
