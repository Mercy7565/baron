import { setCampaignActive } from "@/lib/campaigns";
import { list_campaigns } from "@/server/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return Response.json({ campaigns: list_campaigns() });
}

/** Toggle a campaign on or off. A campaign is a hint; toggling one grants nothing. */
export async function POST(request: Request): Promise<Response> {
  let body: { id?: string; active?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (typeof body.id !== "string" || typeof body.active !== "boolean") {
    return Response.json({ error: "id and active required" }, { status: 400 });
  }

  setCampaignActive(body.id, body.active);
  return Response.json({ campaigns: list_campaigns() });
}
