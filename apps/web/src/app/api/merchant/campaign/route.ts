import { setCampaignActive } from "@/lib/campaigns";
import { addCreatedCampaign, createdCampaigns, setCampaignCancelled } from "@/server/overlay";
import { requireRole } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/merchant/campaign  { id, active }
 *
 * Pause or resume. The suggestion engine reads the same active flag on every
 * basket, so a pause takes effect on the next suggestion rather than at some
 * later refresh.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireRole("merchant");
  if (!auth.ok) return auth.response;

  let body: { id?: string; active?: boolean; cancel?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const id = String(body.id ?? "");
  if (id === "") return Response.json({ error: "id is required" }, { status: 400 });
  // Cancel is final and separate from pause: it removes the campaign from the
  // Live list for good, and no further suggestion or spend can come from it.
  if (body.cancel === true) {
    setCampaignCancelled(id);
    return Response.json({ id, cancelled: true });
  }

  const active = body.active === true;

  // A campaign the merchant created lives in its own list; a shipped one is
  // toggled through the overlay. Both end up equally paused.
  const mine = createdCampaigns().find((c) => c.id === id);
  if (mine !== undefined) {
    addCreatedCampaign({ ...mine, active });
    return Response.json({ id, active });
  }

  const ok = setCampaignActive(id, active);
  if (!ok) return Response.json({ error: "no such campaign" }, { status: 404 });

  return Response.json({ id, active });
}
