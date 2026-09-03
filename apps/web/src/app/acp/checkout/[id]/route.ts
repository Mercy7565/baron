import { getSession, updateSession } from "@/server/acp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = getSession(id);
  if (session === null) return Response.json({ error: "session not found" }, { status: 404 });
  return Response.json({ session });
}

/** POST /acp/checkout/:id — update items on an open session. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = getSession(id);
  if (session === null) return Response.json({ error: "session not found" }, { status: 404 });

  if (session.status !== "open") {
    return Response.json(
      { error: `session is ${session.status} and cannot be updated` },
      { status: 409 },
    );
  }

  let body: {
    items?: Array<{ sku_id: string; qty: number }>;
    requested_discount_bps?: number;
    campaign_id?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const patch: Parameters<typeof updateSession>[1] = {};
  if (Array.isArray(body.items)) patch.items = body.items;
  if (typeof body.requested_discount_bps === "number") {
    patch.requested_discount_bps = body.requested_discount_bps;
  }
  if (body.campaign_id !== undefined) patch.campaign_id = body.campaign_id;

  return Response.json({ session: updateSession(id, patch) });
}
