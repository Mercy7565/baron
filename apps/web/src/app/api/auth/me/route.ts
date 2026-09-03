import { cookies } from "next/headers";

import { SESSION_COOKIE, decodeSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const jar = await cookies();
  const session = await decodeSession(jar.get(SESSION_COOKIE)?.value);

  if (session === null) return Response.json({ authenticated: false, session: null });
  return Response.json({ authenticated: true, session });
}
