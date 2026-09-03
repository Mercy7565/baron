import { cookies } from "next/headers";

import { SESSION_COOKIE, type Role, encodeSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/auth/login { email, role } — demo only, no password. */
export async function POST(request: Request): Promise<Response> {
  let body: { email?: string; role?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim();
  const role = body.role === "merchant" ? "merchant" : body.role === "customer" ? "customer" : null;

  if (email === "") return Response.json({ error: "email is required" }, { status: 400 });
  if (role === null) {
    return Response.json({ error: "role must be customer or merchant" }, { status: 400 });
  }

  const value = await encodeSession({ email, role: role as Role, issued_at: Date.now() });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return Response.json({ ok: true, email, role });
}
