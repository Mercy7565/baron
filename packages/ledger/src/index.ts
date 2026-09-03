/**
 * @countersign/ledger
 *
 * Append-only ledger primitives. For this slice it does one job: turn a
 * (proposal, policy, decision) triple into the four audit values we write into
 * every Razorpay order's `notes`.
 *
 * Everything here is deterministic. The same triple always produces the same
 * decision_id, which is what lets a decision be replayed during a dispute and
 * doubles as a natural idempotency key.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

import type { KernelDecision, Policy, ProposedMoneyAction } from "@countersign/kernel";
import type { OrderNotes } from "@countersign/contracts";

export const LEDGER_VERSION = "0.1.0" as const;

/**
 * JSON with keys sorted at every level, so two structurally identical objects
 * always hash the same regardless of how they were built.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Hash of the exact proposal that was evaluated. */
export function hashInputs(proposal: ProposedMoneyAction): string {
  return sha256Hex(canonicalJson(proposal));
}

/**
 * Hash of the mandate the agent was operating under — the policy that bounded
 * what it was allowed to do.
 */
export function hashMandate(policy: Policy): string {
  return sha256Hex(canonicalJson(policy));
}

/**
 * Derived, not minted: same inputs + same mandate + same decision => same id.
 * No randomness and no clock, so this stays reproducible offline.
 */
export function deriveDecisionId(
  inputsHash: string,
  mandateHash: string,
  decision: KernelDecision,
): string {
  const digest = sha256Hex(`${inputsHash}:${mandateHash}:${canonicalJson(decision)}`);
  // 32 hex chars keeps the whole id at 36 characters, inside Razorpay's
  // 40-character receipt limit when we reuse it as the receipt.
  return `dec_${digest.slice(0, 32)}`;
}

/**
 * The four keys Razorpay carries for us. Confirmed in recon to round-trip
 * intact, which is what makes an order traceable back to its decision.
 */
export function buildOrderNotes(
  proposal: ProposedMoneyAction,
  policy: Policy,
  decision: KernelDecision,
  /**
   * Extra inputs that shaped the request but are not part of the kernel's
   * proposal — the campaign id, for instance. Folded into inputs_hash so a
   * campaign-driven decision cannot be replayed as if no campaign was involved.
   */
  extraInputs: Record<string, string | number | boolean | null> = {},
): OrderNotes {
  const inputs_hash =
    Object.keys(extraInputs).length === 0
      ? hashInputs(proposal)
      : sha256Hex(canonicalJson({ proposal, extra: extraInputs }));
  const mandate_hash = hashMandate(policy);
  return {
    decision_id: deriveDecisionId(inputs_hash, mandate_hash, decision),
    mandate_hash,
    inputs_hash,
    policy_version: policy.policy_version,
  };
}

// ------------------------------------------------------------- the audit log

/**
 * A hash-chained, append-only log on disk. Each record commits to the hash of
 * the one before it, so a row cannot be edited, reordered or removed after the
 * fact without breaking every hash that follows. `/audit` verifies the chain on
 * every render.
 *
 * This is the placeholder for the database: good enough to prove the audit
 * story locally, deliberately trivial to throw away when the DB slice lands. It
 * will not persist on serverless hosts, whose filesystems are ephemeral.
 *
 * Path defaults to `.data/audit.jsonl` relative to the process working
 * directory; override with AUDIT_LOG_PATH.
 */

export type AuditKind = "decision" | "payment" | "verify_fail";

/** The facts of one event, before it is chained. */
export interface AuditPayload {
  kind: AuditKind;
  decision_id: string | null;
  order_id: string | null;
  payment_id: string | null;
  /** Razorpay's x-razorpay-event-id header, when the row came from a webhook. */
  event_id: string | null;
  verdict: string;
  offer_id: string | null;
  /** null when no order was created — a refusal has nothing to attach. */
  attached_ok: boolean | null;
  /** verified | verify_fail | duplicate | no_decision_id — null for decisions. */
  webhook_status: string | null;

  /**
   * Added in schema_version 2.
   *
   * Optional on purpose. Each record hashes its own literal field set and
   * canonicalJson drops undefined, so rows written before these fields existed
   * still verify byte-for-byte. Adding a field to new rows cannot invalidate an
   * old row's hash, and prev_hash linkage is untouched — so the existing chain
   * keeps verifying rather than needing a new genesis segment.
   */
  schema_version?: number;
  quote_id?: string | null;
  agent_id?: string | null;
  /** Last four digits only. Never a PAN, never a token_id. */
  last4?: string | null;
  presence?: "agent" | "hitl" | null;
  capture_mode?: string | null;
}

export interface AuditRecord extends AuditPayload {
  seq: number;
  ts: string;
  prev_hash: string;
  hash: string;
}

const GENESIS_HASH = "0".repeat(64);

export function auditLogPath(): string {
  return resolve(process.env.AUDIT_LOG_PATH ?? ".data/audit.jsonl");
}

/** The hash of a record is over every field except the hash itself. */
export function hashAuditRecord(record: Omit<AuditRecord, "hash">): string {
  return sha256Hex(canonicalJson(record));
}

/**
 * A line only counts as a record if it carries the chain fields. Anything else
 * — a torn write, or a row from an older log format — is not something we can
 * verify, so it is not something we will display or chain onto.
 */
function isAuditRecord(value: unknown): value is AuditRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<AuditRecord>;
  return (
    typeof r.seq === "number" &&
    Number.isInteger(r.seq) &&
    typeof r.ts === "string" &&
    typeof r.hash === "string" &&
    r.hash.length === 64 &&
    typeof r.prev_hash === "string" &&
    r.prev_hash.length === 64
  );
}

/** Every record, oldest first. Unusable lines are skipped, never thrown. */
export function readAuditRecords(): AuditRecord[] {
  const path = auditLogPath();
  if (!existsSync(path)) return [];

  const out: AuditRecord[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      // A torn write should not take the audit page down, and an unverifiable
      // row must never become the anchor for the rows that follow it.
      if (isAuditRecord(parsed)) out.push(parsed);
    } catch {
      // Same reasoning for a line that is not JSON at all.
    }
  }
  return out;
}

export function appendAuditRecord(payload: AuditPayload): AuditRecord {
  const existing = readAuditRecords();
  const last = existing.length > 0 ? existing[existing.length - 1] : undefined;

  const unhashed: Omit<AuditRecord, "hash"> = {
    seq: last === undefined ? 0 : last.seq + 1,
    ts: new Date().toISOString(),
    prev_hash: last === undefined ? GENESIS_HASH : last.hash,
    ...payload,
  };

  const full: AuditRecord = { ...unhashed, hash: hashAuditRecord(unhashed) };

  const path = auditLogPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(full)}\n`, "utf8");
  return full;
}

export type ChainStatus = { ok: true; length: number } | { ok: false; brokenAt: number };

/**
 * Walk the chain. A record is valid when its prev_hash matches the previous
 * record's hash and its own hash still covers its contents.
 */
export function verifyAuditChain(records: AuditRecord[] = readAuditRecords()): ChainStatus {
  let prev = GENESIS_HASH;

  for (const record of records) {
    if (record.prev_hash !== prev) return { ok: false, brokenAt: record.seq };

    const { hash, ...rest } = record;
    if (hashAuditRecord(rest) !== hash) return { ok: false, brokenAt: record.seq };

    prev = hash;
  }

  return { ok: true, length: records.length };
}

/** Most recent first. */
export function readRecentAuditRecords(limit = 20): AuditRecord[] {
  return readAuditRecords().slice(-limit).reverse();
}

/**
 * The decision behind a paid order.
 *
 * Matched on order_id, not decision_id: decision_id is derived from the
 * proposal, so two identical proposals share one decision_id while Razorpay
 * still mints a separate order for each. Joining on decision_id alone would
 * attach a payment to the wrong decision row.
 */
export function findDecisionForOrder(orderId: string): AuditRecord | null {
  const matches = readAuditRecords().filter(
    (r) => r.kind === "decision" && r.order_id === orderId,
  );
  return matches.length > 0 ? (matches[matches.length - 1] ?? null) : null;
}

/** Razorpay retries webhooks; the same delivery must not be logged twice. */
export function hasEventRecord(eventId: string): boolean {
  return readAuditRecords().some((r) => r.event_id === eventId);
}

export function hasPaymentRecord(paymentId: string): boolean {
  return readAuditRecords().some((r) => r.kind === "payment" && r.payment_id === paymentId);
}

/** Newest CLAMP decision that actually produced an order — used by replay:webhook. */
export function findLatestClampedOrder(): AuditRecord | null {
  const matches = readAuditRecords().filter(
    (r) => r.kind === "decision" && r.verdict === "CLAMP" && r.order_id !== null,
  );
  return matches.length > 0 ? (matches[matches.length - 1] ?? null) : null;
}
