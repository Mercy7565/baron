import { getSession, updateSession } from "@/server/acp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /acp/checkout/:id/cancel — terminal. A cancelled session cannot complete. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = getSession(id);
  if (session === null) return Response.json({ error: "session not found" }, { status: 404 });

  if (session.status === "completed") {
    return Response.json({ error: "session already completed" }, { status: 409 });
  }

  return Response.json({ session: updateSession(id, { status: "cancelled" }) });
}
