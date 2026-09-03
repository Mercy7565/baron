import type { CartLine } from "@countersign/catalog";

/**
 * ACP-shaped checkout sessions.
 *
 * "Shaped", not conformant: we implement a create/update/complete/cancel
 * lifecycle because that is the part an outside agent actually needs to drive a
 * purchase. Delegated payment, Stripe shared payment tokens and ACP's webhook
 * signing scheme are not implemented, and /protocols says so by name.
 */
export type AcpStatus = "open" | "completed" | "cancelled";

export interface AcpSession {
  id: string;
  status: AcpStatus;
  items: CartLine[];
  requested_discount_bps: number;
  mandate_hash: string;
  campaign_id: string | null;
  created_at: string;
  updated_at: string;
  /** Populated on complete. */
  result: unknown;
}

const globalForAcp = globalThis as typeof globalThis & {
  __countersign_acp?: Map<string, AcpSession>;
};

const SESSIONS: Map<string, AcpSession> =
  globalForAcp.__countersign_acp ?? new Map<string, AcpSession>();

globalForAcp.__countersign_acp = SESSIONS;

let counter = 0;

export function createSession(input: {
  items: CartLine[];
  requested_discount_bps: number;
  mandate_hash: string;
  campaign_id: string | null;
}): AcpSession {
  counter += 1;
  const now = new Date().toISOString();
  const session: AcpSession = {
    id: `acp_${Date.now().toString(36)}${counter.toString(36)}`,
    status: "open",
    items: input.items,
    requested_discount_bps: input.requested_discount_bps,
    mandate_hash: input.mandate_hash,
    campaign_id: input.campaign_id,
    created_at: now,
    updated_at: now,
    result: null,
  };
  SESSIONS.set(session.id, session);
  return session;
}

export function getSession(id: string): AcpSession | null {
  return SESSIONS.get(id) ?? null;
}

export function updateSession(id: string, patch: Partial<AcpSession>): AcpSession | null {
  const existing = SESSIONS.get(id);
  if (existing === undefined) return null;
  const next: AcpSession = { ...existing, ...patch, updated_at: new Date().toISOString() };
  SESSIONS.set(id, next);
  return next;
}
