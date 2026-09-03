/**
 * @countersign/resume
 *
 * Self-contained, HMAC-signed resume tokens for the two-round shop API.
 *
 * The first version kept round-1 state in a JSONL file. That works on one
 * machine and fails on serverless: round 2 can land on a different instance
 * with a different ephemeral disk, and the shopper is told their token expired
 * when it did not. So the token now *carries* its own state and is verified by
 * signature — any instance holding the same secret can complete round 2.
 *
 * Web Crypto, so the same code runs in a route handler and in middleware.
 */

export const RESUME_VERSION = "0.1.0" as const;

/** Fifteen minutes, matching the quote's own short life. */
export const RESUME_TTL_MS = 15 * 60 * 1000;

export interface ResumeLine {
  sku_id: string;
  qty: number;
}

export interface ResumeSuggestion {
  sku_id: string;
  title: string;
  price_paise: number;
  extra_bps: number;
}

export interface ResumePayload {
  /** What the shopper originally asked for, kept for the audit trail. */
  intent: string;
  lines: ResumeLine[];
  suggestions: ResumeSuggestion[];
  mandate_hash: string;
  /** Milliseconds since epoch. */
  exp: number;
}

export type VerifyFailure = "invalid" | "expired" | "malformed";

export type VerifyResult =
  | { ok: true; payload: ResumePayload }
  | { ok: false; reason: VerifyFailure };

export function resumeSecret(): string {
  return process.env.RESUME_SECRET ?? "baron-dev-resume-secret";
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64urlEncode(new Uint8Array(sig));
}

/** Mint a token that carries everything round 2 needs. */
export async function signResume(
  payload: Omit<ResumePayload, "exp"> & { exp?: number },
  secret = resumeSecret(),
  now = Date.now(),
): Promise<string> {
  const full: ResumePayload = { ...payload, exp: payload.exp ?? now + RESUME_TTL_MS };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(full)));
  return `rt_${body}.${await sign(body, secret)}`;
}

/**
 * Verify and decode. A tampered token is `invalid`; a stale one is `expired`.
 * The two are reported separately so the caller can say which happened.
 */
export async function verifyResume(
  token: string | null | undefined,
  secret = resumeSecret(),
  now = Date.now(),
): Promise<VerifyResult> {
  if (typeof token !== "string" || !token.startsWith("rt_")) {
    return { ok: false, reason: "malformed" };
  }

  const withoutPrefix = token.slice(3);
  const dot = withoutPrefix.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };

  const body = withoutPrefix.slice(0, dot);
  const provided = withoutPrefix.slice(dot + 1);

  // Signature first: nothing inside an unverified token is worth reading.
  if ((await sign(body, secret)) !== provided) return { ok: false, reason: "invalid" };

  let payload: ResumePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as ResumePayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!Array.isArray(payload.lines) || typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }

  if (payload.exp <= now) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}
