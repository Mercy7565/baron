import type { AuditRecord } from "@countersign/ledger";

/**
 * One plain sentence per row.
 *
 * An audit trail nobody can read is not explainability, it is a receipt for
 * lawyers. Every row says what was asked, what policy did about it, and what
 * actually happened to money — in words, before any JSON.
 */
export function explain(r: AuditRecord): string {
  const offer = r.offer_id ?? null;

  if (r.kind === "verify_fail") {
    return "An unsigned or wrongly-signed webhook hit the money boundary. It was refused with HTTP 400 and recorded here.";
  }

  if (r.kind === "decision") {
    if (r.verdict === "REJECT") {
      return "Policy refused this proposal. No Razorpay order was created and no money path opened.";
    }
    if (r.verdict === "ESCALATE") {
      return "The amount is above the escalation threshold, so a human decides. Nothing was auto-applied.";
    }
    const attached = offer !== null ? ` and attached ${offer}` : " with no offer";

    // Only a CLAMP row is evidence that the agent overreached. Saying so on an
    // ALLOW row asserts something the record does not contain.
    if (r.verdict === "CLAMP") {
      return `Agent asked for more discount than policy allows, so policy clamped it${attached}. Order created; nothing captured yet.`;
    }
    return `Policy allowed this proposal as asked${attached}. Order created; nothing captured yet.`;
  }

  // kind === "payment"
  if (r.capture_mode === "payment_link") {
    // The record carries no basis-point figures, so this sentence must not
    // quote any. It says which way the verdict went and stops at the fact:
    // a Payment Link. What did not happen is not worth a paragraph on every
    // row — the reader can see there is no payment id.
    const outcome =
      r.verdict === "CLAMP"
        ? "Policy reduced the discount to the largest coupon this basket qualified for"
        : "Policy allowed the discount as asked";
    const link = r.quote_id !== null && r.quote_id !== undefined ? ` ${r.quote_id}` : "";
    return `${outcome}${offer !== null ? ` (${offer})` : ""}. Payment Link${link}.`;
  }

  if (r.capture_mode === "blocked") {
    return "A Payment Link was created but the hosted page blocked automated completion. No payment id was invented; the attempt is recorded as blocked.";
  }

  if (r.capture_mode === "simulated") {
    return `Simulated capture recorded against ${
      r.payment_id ?? "an order"
    }. This is not a Razorpay-captured payment.`;
  }

  return `Webhook ${r.webhook_status ?? "event"} recorded for ${r.payment_id ?? "this order"}.`;
}

export function AuditTable({ records }: { records: AuditRecord[] }) {
  return (
    <div className="cs-stack" style={{ gap: 0 }}>
      {records.map((r) => (
        <details key={r.seq} className="nl-row" data-seq={r.seq}>
          <summary>
            <span className="mono nl-sub">#{r.seq}</span>{" "}
            <strong>{r.verdict}</strong>{" "}
            <span className="nl-sub">{r.kind}</span>{" "}
            {r.capture_mode !== null && r.capture_mode !== undefined && (
              <span className="nl-pill" data-tone={r.capture_mode === "blocked" ? "blocked" : undefined}>
                {r.capture_mode}
              </span>
            )}
          </summary>

          {/* The sentence, not the JSON. */}
          <p className="nl-explain">{explain(r)}</p>

          <div className="cs-scroll-x" style={{ marginTop: "var(--space)" }}>
            <table className="cs-table">
              <tbody>
                <tr>
                  <th>quote_id</th>
                  <td>{r.quote_id ?? "—"}</td>
                  <th>verdict</th>
                  <td>{r.verdict}</td>
                </tr>
                <tr>
                  <th>offer</th>
                  <td className={r.offer_id !== null ? "cs-ok" : undefined}>{r.offer_id ?? "none"}</td>
                  <th>card</th>
                  {/* A link issuance charges nothing, so say so rather than showing a card. */}
                  <td>{r.capture_mode === "payment_link" ? "no vault charge" : (r.last4 !== null && r.last4 !== undefined ? `•••• ${r.last4}` : "—")}</td>
                </tr>
                <tr>
                  <th>presence</th>
                  <td>{r.presence ?? "—"}</td>
                  <th>payment_link</th>
                  <td>{r.quote_id !== null && r.capture_mode === "payment_link" ? "issued" : "—"}</td>
                </tr>
                <tr>
                  <th>decision_id</th>
                  <td>{r.decision_id ?? "—"}</td>
                  <th>order_id</th>
                  <td>{r.order_id ?? "—"}</td>
                </tr>
                <tr>
                  <th>ts</th>
                  <td>{r.ts}</td>
                  <th>hash</th>
                  <td className="mono">{r.hash.slice(0, 16)}…</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}
