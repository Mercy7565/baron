/**
 * The flags every Baron cookie is set with.
 *
 * One place, because four call sites drifting apart is how a session cookie
 * ends up with different rules from the basket cookie it has to survive
 * alongside.
 *
 * `secure` is on wherever the site is served over HTTPS and off on a plain
 * localhost dev server, where a Secure cookie would simply never be stored.
 * Mobile browsers are stricter than desktop about this — Safari in particular
 * treats a non-Secure cookie on an HTTPS origin as a thing to be suspicious of
 * — and the failure mode is silent: the cookie is dropped and the server sees
 * a visitor who has no basket, no shop and no session.
 *
 * `sameSite: "lax"` keeps the cookie on ordinary navigation to the site,
 * including the return trip from Razorpay's payment page, while still refusing
 * to ride along on a cross-site POST.
 */
export function cookieOptions(maxAgeSeconds: number): {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
} {
  const base = process.env.APP_BASE_URL ?? "";
  const https = base.startsWith("https://") || process.env.VERCEL === "1";

  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: https,
    maxAge: maxAgeSeconds,
  };
}

/** Eight hours: long enough for a session, short enough to expire on its own. */
export const SESSION_MAX_AGE = 60 * 60 * 8;

/** A week, for the things a shopper expects to still be there tomorrow. */
export const SHOPPING_MAX_AGE = 60 * 60 * 24 * 7;
