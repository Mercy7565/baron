import { cookies } from "next/headers";

import { requireRole } from "@/server/require-role";
import { SHOP_CODE_COOKIE, enteredCode, normaliseCode, tenantForCode } from "@/server/shop-code";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/shop/code { code }
 *
 * Unlock a merchant's shop for this browser. A wrong code opens nothing — the
 * cookie is only written for a code that actually resolves to a tenant, so a
 * shopper cannot get a catalog by guessing at the cookie's existence.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireRole("customer");
  if (!auth.ok) return auth.response;

  let body: { code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const code = normaliseCode(String(body.code ?? ""));
  if (code === "") return Response.json({ error: "Enter a shop code." }, { status: 400 });

  const tenant = tenantForCode(code);
  if (tenant === null) {
    return Response.json({ error: "No shop uses that code." }, { status: 404 });
  }

  const jar = await cookies();
  jar.set(SHOP_CODE_COOKIE, code, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return Response.json({ ok: true, code, tenant_id: tenant });
}

/**
 * GET — which shop, if any, this browser is standing in.
 *
 * The assistant asks this before it will do anything, because it renders on
 * more than one page and the cookie is httpOnly: the client cannot read the
 * flag it is gated on, so it has to be told.
 */
export async function GET(): Promise<Response> {
  const code = await enteredCode();
  return Response.json({ unlocked: code !== null, code });
}

/** DELETE — leave the shop, so the code gate can be demonstrated twice. */
export async function DELETE(): Promise<Response> {
  const jar = await cookies();
  jar.delete(SHOP_CODE_COOKIE);
  return Response.json({ ok: true });
}
