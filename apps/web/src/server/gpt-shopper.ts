import { tenantForCode, normaliseCode } from "@/server/shop-code";
import { isBuiltIn } from "@/server/users";

/**
 * The Custom GPT surface.
 *
 * A GPT calls these Actions from OpenAI's infrastructure: no cookie, no
 * browser, no way to hold the httpOnly shop-code cookie the in-app assistant
 * uses. So the two things a request needs — which shop, and which shopper —
 * travel explicitly: the shop as a parameter on every call, the shopper as a
 * header.
 *
 * This is demo authentication and is labelled as such everywhere it appears. It
 * proves the *shape* of agent commerce — an outside model can shop, and still
 * cannot move money the kernel has not agreed to — not the identity story. What
 * matters is the other half: nothing on this surface ever returns a card
 * number, a CVV, a one-time code, a Razorpay secret, or the contents of a
 * wallet, because none of those are ever put into a response body.
 */

/** The header a GPT sends to say who it is shopping for. */
export const SHOPPER_HEADER = "x-baron-shopper";

/**
 * Who this call is for.
 *
 * A built-in demo account is honoured by name so a GPT's order lands in the
 * same `/orders` page the judge is already looking at in a browser. Anything
 * else falls back to the shared demo buyer rather than being invented, because
 * accepting an arbitrary string here would let a caller file an order against
 * someone else's name.
 */
export function shopperFrom(request: Request): string {
  const raw = (request.headers.get(SHOPPER_HEADER) ?? "").trim().toLowerCase();
  if (raw === "") return "demo";
  return isBuiltIn(raw) ? raw : "demo";
}

export interface ShopScope {
  code: string;
  tenant_id: string;
}

/**
 * Resolve the shop code carried on a call.
 *
 * A wrong or missing code is a 404 and nothing else: no catalog, no near-miss
 * suggestion, no hint about which codes exist. A GPT that has not been told
 * which shop it is in has no business seeing a shelf.
 */
export function scopeFor(code: string | null): ShopScope | null {
  if (code === null || code.trim() === "") return null;
  const tenant = tenantForCode(code);
  return tenant === null ? null : { code: normaliseCode(code), tenant_id: tenant };
}

/** The 404 every unscoped call gets, worded the same way each time. */
export function noSuchShop(): Response {
  return json(
    {
      error: "no_such_shop",
      message:
        "No shop uses that code. Ask the shopper for the code their merchant gave them, then call resolve_shop_code first.",
    },
    404,
  );
}

/**
 * Every response on this surface goes through here.
 *
 * One place that sets CORS and no-store, and one place to be sure of what is
 * being sent. Card numbers, CVVs, one-time codes, Razorpay secrets and wallet
 * contents are never assembled into these bodies in the first place; this is
 * the last gate that says so out loud.
 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": `content-type, ${SHOPPER_HEADER}`,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "cache-control": "no-store",
    },
  });
}

/** Preflight, shared by every route on this surface. */
export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": `content-type, ${SHOPPER_HEADER}`,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-max-age": "86400",
    },
  });
}

/**
 * Field names that must never appear in a response on this surface.
 *
 * Kept as data so a test can assert against the real bodies rather than
 * against a promise in a comment.
 */
export const FORBIDDEN_RESPONSE_KEYS: readonly string[] = [
  "pan",
  "card_number",
  "cvv",
  "cvc",
  "otp",
  "one_time_code",
  "key_secret",
  "razorpay_key_secret",
  "webhook_secret",
  "session_secret",
  "wallet",
  "card_token",
  "vault_token",
  "expiry",
];

/** True when an object graph contains any key a GPT must never receive. */
export function leaksSecret(value: unknown, seen = new Set<unknown>()): string | null {
  if (typeof value !== "object" || value === null) return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = leaksSecret(item, seen);
      if (hit !== null) return hit;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RESPONSE_KEYS.includes(key.toLowerCase())) return key;
    const hit = leaksSecret(child, seen);
    if (hit !== null) return hit;
  }
  return null;
}
