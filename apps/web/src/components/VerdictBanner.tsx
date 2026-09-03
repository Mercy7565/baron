const TONE: Record<string, string> = {
  ALLOW: "ok",
  CLAMP: "warn",
  REJECT: "danger",
  ESCALATE: "warn",
};

/**
 * The one component that must never be decorative. It states what was asked,
 * what was applied, which offer id, and what was thrown away.
 */
export function VerdictBanner({
  verdict,
  requestedBps,
  appliedBps,
  offerIds,
  ignoredInputs,
  razorpayCalls,
  orderId,
}: {
  verdict: string;
  requestedBps: number;
  appliedBps: number;
  offerIds: string[];
  ignoredInputs: string[];
  razorpayCalls?: number | undefined;
  orderId?: string | null | undefined;
}) {
  const tone = TONE[verdict] ?? "warn";

  return (
    <section className="cs-card cs-stack" data-verdict={verdict}>
      <div className="cs-row" style={{ justifyContent: "space-between" }}>
        <strong className={`cs-${tone === "ok" ? "ok" : tone === "danger" ? "danger" : "warn"}`}>
          {verdict}
        </strong>
        {razorpayCalls !== undefined && (
          <span className="cs-badge" data-tone={razorpayCalls === 0 ? "ok" : undefined}>
            razorpay_calls_this_request: {razorpayCalls}
          </span>
        )}
      </div>

      <div className="mono" style={{ fontSize: 13 }}>
        asked {requestedBps} bps → applied {appliedBps} bps
      </div>

      <div className="mono" style={{ fontSize: 13 }}>
        offer_id: {offerIds.length > 0 ? offerIds.join(", ") : "—"}
      </div>

      {ignoredInputs.length > 0 && (
        <div className="cs-warn mono" style={{ fontSize: 13 }}>
          ignored_inputs:
          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
            {ignoredInputs.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {orderId != null && (
        <div className="mono" style={{ fontSize: 13 }}>
          <a href={`/gate/${orderId}`}>pay {orderId} →</a>
        </div>
      )}
    </section>
  );
}
