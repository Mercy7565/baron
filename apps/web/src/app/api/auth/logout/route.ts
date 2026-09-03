import { cookies } from "next/headers";

import { SESSION_COOKIE } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
