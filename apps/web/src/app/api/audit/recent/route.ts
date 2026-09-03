import { readRecentAuditRecords } from "@countersign/ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return Response.json({ records: readRecentAuditRecords(5) });
}
