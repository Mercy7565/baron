import { readAuditRecords, verifyAuditChain } from "@countersign/ledger";

import { ConsoleChrome } from "@/components/ConsoleChrome";
import { couponPercentOf, paidDecisionRows, rowAsText, whyRow } from "@/server/ledger-rows";

import { LedgerTable } from "./LedgerTable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MerchantAudit() {
  const chain = verifyAuditChain(readAuditRecords());

  /**
   * Razorpay first, the local log folded in.
   *
   * This read the quote log alone, which lives in /tmp on a serverless host and
   * does not survive a cold start — so the one page whose whole claim is that
   * it can account for money went blank while the dashboard showed captures.
   */
  const rows = await paidDecisionRows();
  const unexplained = rows.filter((r) => !r.verdict_known).length;

  // Computed on the server so the client component stays presentational and the
  // copied text is identical to what the page rendered.
  const why: Record<string, string> = {};
  const text: Record<string, string> = {};
  const coupon: Record<string, string> = {};
  for (const r of rows) {
    why[r.key] = whyRow(r);
    text[r.key] = rowAsText(r);
    const pct = couponPercentOf(r.offer_id);
    if (pct !== null) coupon[r.key] = pct;
  }

  const printedAt = new Date();
  const pageText = [
    `Baron — money decision ledger`,
    `Exported ${printedAt.toISOString()}`,
    chain.ok ? `Chain OK, ${rows.length} paid` : `CHAIN BROKEN AT seq=${chain.brokenAt}`,
    `${rows.length} payment${rows.length === 1 ? "" : "s"}`,
    ``,
    ...rows.map((r) => `${"─".repeat(66)}\n${text[r.key] ?? ""}`),
  ].join("\n");

  return (
    <ConsoleChrome current="/merchant/audit">
      <h1>The model asked. The ledger answers.</h1>
      <p className="mc-sub">
        Rows are only succeeded payments. Each one carries what was asked, what policy allowed, and
        the coupon Razorpay attached. Click a row for the reason in plain English.
      </p>
      <p className="page-help">
        Every paid order in one line, with the coupon that applied. Rows are hash-chained, so a
        change to an earlier row would break the chain and show up here.
      </p>

      <div
        className="mc-panel mc-chain"
        data-ok={chain.ok ? "yes" : "no"}
        style={{ marginBottom: 12 }}
      >
        {chain.ok ? `CHAIN OK · ${rows.length} paid` : `CHAIN BROKEN AT seq=${chain.brokenAt}`}
      </div>

      {unexplained > 0 && (
        <div className="mc-banner" style={{ marginBottom: 12 }}>
          {unexplained} of these {rows.length} payments predate the decision being written onto the
          Razorpay order. Their coupon is read back from the offer that attached, so the rung is
          exact; what was originally asked for is not recorded on them.
        </div>
      )}

      <div className="print-only mc-printhead">
        <strong>Baron — money decision ledger.</strong> Exported {printedAt.toISOString()}.{" "}
        {chain.ok ? `Chain OK, ${rows.length} paid.` : `CHAIN BROKEN at seq=${chain.brokenAt}.`}
      </div>

      <LedgerTable rows={rows} why={why} text={text} coupon={coupon} pageText={pageText} />
    </ConsoleChrome>
  );
}
