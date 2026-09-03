import { readFileSync, existsSync, writeFileSync } from "node:fs";

import { auditLogPath } from "@countersign/ledger";
import { loadQuotes, quoteLogPath } from "@countersign/quotes";

import { LIVE_OFFER_IDS, LADDER_SHIPPED_AT } from "@/server/live-rows";
import { requireRole } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/merchant/purge-demo
 *
 * Remove ledger rows that name a coupon the store can no longer attach.
 *
 * The logs carry history from two retired coupon sets — `offer_TVG*` from the
 * first Razorpay account, `offer_PENDING_*` from before the dashboard ids
 * arrived. They are real history, but they describe coupons that cannot apply
 * any more, and mixed into a console they make every number a lie.
 *
 * This rewrites the two JSONL files without those rows. It never edits a row,
 * never marks anything paid, and never touches orders — a real payment stays a
 * real payment. Everything it removes named a dead coupon.
 */
function purgeJsonl(path: string, keep: (row: Record<string, unknown>) => boolean): {
  kept: number;
  removed: number;
} {
  if (!existsSync(path)) return { kept: 0, removed: 0 };

  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  const survivors: string[] = [];
  let removed = 0;

  for (const line of lines) {
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // An unparseable line is not a demo row; leave it be.
      survivors.push(line);
      continue;
    }
    if (keep(row)) survivors.push(line);
    else removed += 1;
  }

  writeFileSync(path, survivors.length === 0 ? "" : `${survivors.join("\n")}\n`, "utf8");
  return { kept: survivors.length, removed };
}

/** A row is retired when it names a dead coupon, or names none and predates the ladder. */
function isRetired(row: Record<string, unknown>): boolean {
  const offer = row.offer_id;
  if (typeof offer === "string" && offer !== "") return !LIVE_OFFER_IDS.has(offer);

  const created = row.created_at ?? row.ts;
  return typeof created === "string" ? created < LADDER_SHIPPED_AT : false;
}

export async function POST(): Promise<Response> {
  const auth = await requireRole("merchant");
  if (!auth.ok) return auth.response;

  const quotes = purgeJsonl(quoteLogPath(), (row) => !isRetired(row));
  const audit = purgeJsonl(auditLogPath(), (row) => !isRetired(row));

  // Rebuild the in-memory index from the rewritten file.
  loadQuotes(true);

  return Response.json({
    quotes_removed: quotes.removed,
    quotes_kept: quotes.kept,
    audit_removed: audit.removed,
    audit_kept: audit.kept,
    // Said plainly: the hash chain will not verify across a gap, and that is
    // the honest consequence of deleting rows from an append-only log.
    note:
      audit.removed > 0
        ? "Audit rows were removed, so the hash chain no longer verifies end to end. That is expected after a purge."
        : "No audit rows needed removing.",
  });
}
