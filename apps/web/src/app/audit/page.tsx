import { auditLogPath, readAuditRecords, readRecentAuditRecords, verifyAuditChain } from "@countersign/ledger";

import { AuditTable } from "@/components/AuditTable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AuditPage() {
  // Verify the whole chain, not just the visible window — a tampered row
  // outside the last 20 still has to show up.
  const chain = verifyAuditChain(readAuditRecords());
  const records = readRecentAuditRecords(20);

  return (
    <main>
      {/* First line on the page, deliberately: the trail is worthless if the
          chain does not hold. */}
      <div
        className="cs-card"
        style={{
          borderColor: chain.ok ? "var(--ok)" : "var(--danger)",
          color: chain.ok ? "var(--ok)" : "var(--danger)",
          fontWeight: 700,
          marginBottom: "var(--space-2)",
        }}
      >
        {chain.ok ? `CHAIN OK (${chain.length} records)` : `CHAIN BROKEN AT seq=${chain.brokenAt}`}
      </div>

      <h1>Audit — last 20</h1>
      <p className="cs-muted" style={{ fontSize: 12 }}>
        {auditLogPath()} · newest first · each row commits to the hash of the row before it
      </p>

      {records.length === 0 ? (
        <p>No records yet. Propose an order from /cart or /lab.</p>
      ) : (
        <AuditTable records={records} />
      )}
    </main>
  );
}
