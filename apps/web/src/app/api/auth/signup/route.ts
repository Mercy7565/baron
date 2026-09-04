import { cookies } from "next/headers";

import { SESSION_COOKIE, type Role, encodeSession } from "@/server/session";
import { register } from "@/server/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/signup { username, password, role }
 *
 * Creates the account and signs it in, because making someone type the same
 * two fields twice to see a demo is a tax on the person evaluating it.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { username?: string; password?: string; role?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const role: Role | null =
    body.role === "merchant" ? "merchant" : body.role === "customer" ? "customer" : null;
  if (role === null) {
    return Response.json({ error: "Choose merchant or shopper." }, { status: 400 });
  }

  const result = register(String(body.username ?? ""), String(body.password ?? ""), role);
  if (!result.ok || result.username === undefined) {
    return Response.json({ error: result.error ?? "Could not create that account." }, { status: 409 });
  }

  const value = await encodeSession({ email: result.username, role, issued_at: Date.now() });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return Response.json({ ok: true, username: result.username, role });
}
