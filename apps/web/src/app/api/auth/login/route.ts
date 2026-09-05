import { cookies } from "next/headers";

import { cookieOptions, SESSION_MAX_AGE } from "@/server/cookie-options";
import { SESSION_COOKIE, encodeSession } from "@/server/session";
import { authenticate } from "@/server/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/login { username, password }
 *
 * The role comes from the account, never from the request: a form that could
 * name its own role would make the merchant console a text field away.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { username?: string; password?: string; email?: string; role?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const username = String(body.username ?? body.email ?? "").trim();
  const password = String(body.password ?? "");

  const result = authenticate(username, password);
  if (!result.ok || result.role === undefined || result.username === undefined) {
    return Response.json({ error: result.error ?? "Could not sign you in." }, { status: 401 });
  }

  const value = await encodeSession({
    email: result.username,
    role: result.role,
    issued_at: Date.now(),
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, value, cookieOptions(SESSION_MAX_AGE));

  return Response.json({ ok: true, username: result.username, role: result.role });
}
