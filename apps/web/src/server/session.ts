/**
 * Demo sessions.
 *
 * A signed cookie carrying an email and a role. No password, no OAuth — the
 * point of this is the *split*, not the identity. It is signed rather than
 * plain so a role cannot be flipped by editing a cookie in devtools, which
 * would make the whole demo meaningless.
 *
 * Uses Web Crypto so the same code runs in middleware (edge) and in route
 * handlers (node).
 */

export type Role = "customer" | "merchant";

export interface Session {
  email: string;
  role: Role;
  issued_at: number;
}

export const SESSION_COOKIE = "nl_session";

/**
 * The signing key for session cookies.
 *
 * The fallback is a development convenience so the demo runs without an env
 * file; a real deployment sets SESSION_SECRET. Changing this string invalidates
 * every cookie signed with the old one, which is the correct behaviour for a
 * key rotation — there is deliberately no migration path, because accepting
 * signatures from a retired key is the bug rotation exists to prevent.
 */
function secret(): string {
  return process.env.SESSION_SECRET ?? "baron-demo-session-secret";
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

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64urlEncode(new Uint8Array(sig));
}

export async function encodeSession(session: Session): Promise<string> {
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(session)));
  return `${payload}.${await sign(payload)}`;
}

/** Returns null for anything that is not a validly signed session. */
export async function decodeSession(cookie: string | undefined | null): Promise<Session | null> {
  if (cookie === undefined || cookie === null || cookie === "") return null;

  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = cookie.slice(0, dot);
  const provided = cookie.slice(dot + 1);

  // A forged or edited cookie fails here, so a customer cannot promote
  // themselves to merchant by hand.
  if ((await sign(payload)) !== provided) return null;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as Session;
    if (parsed.role !== "customer" && parsed.role !== "merchant") return null;
    if (typeof parsed.email !== "string" || parsed.email === "") return null;
    return parsed;
  } catch {
    return null;
  }
}
