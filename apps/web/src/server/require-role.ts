import { cookies } from "next/headers";

import { SESSION_COOKIE, type Role, type Session, decodeSession } from "@/server/session";

/**
 * Role check for API routes.
 *
 * Middleware guards the *pages*, which is not the same as guarding the API. A
 * logged-out `curl` to /api/merchant/catalog would otherwise edit the store, so
 * every mutating merchant route calls this first.
 */
export async function requireRole(
  role: Role,
): Promise<{ ok: true; session: Session } | { ok: false; response: Response }> {
  const jar = await cookies();
  const session = await decodeSession(jar.get(SESSION_COOKIE)?.value);

  if (session === null) {
    return {
      ok: false,
      response: Response.json(
        { error: "not_authenticated", need: role, continue_url: "/login" },
        { status: 401 },
      ),
    };
  }

  if (session.role !== role) {
    return {
      ok: false,
      response: Response.json(
        { error: "wrong_role", have: session.role, need: role, continue_url: "/login" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, session };
}

/** The buyer key for orders: the signed-in customer, or the shared demo buyer. */
export async function buyerId(): Promise<string> {
  const jar = await cookies();
  const session = await decodeSession(jar.get(SESSION_COOKIE)?.value);
  return session !== null && session.role === "customer" ? session.email : "demo";
}
