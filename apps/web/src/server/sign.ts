/**
 * Signing for values we hand to a browser and expect back unchanged.
 *
 * Same construction as the session cookie — HMAC-SHA256 over a base64url
 * payload, Web Crypto so it runs on the edge and in a route handler alike —
 * pulled out here because the basket needs it too and duplicating a signing
 * routine is how two of them end up disagreeing.
 *
 * This proves the value came from us. It is not encryption: the contents are
 * readable by anyone holding the cookie, which is fine, because a basket is a
 * list of things the shopper themselves put in it.
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
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(payload: string): Promise<string> {
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

/** `payload.signature`, base64url, safe in a cookie. */
export async function signValue(plain: string): Promise<string> {
  const payload = b64urlEncode(new TextEncoder().encode(plain));
  return `${payload}.${await hmac(payload)}`;
}

/** The original string, or null for anything not validly signed by us. */
export async function verifyValue(signed: string): Promise<string | null> {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = signed.slice(0, dot);
  const provided = signed.slice(dot + 1);
  if ((await hmac(payload)) !== provided) return null;

  try {
    return new TextDecoder().decode(b64urlDecode(payload));
  } catch {
    return null;
  }
}
