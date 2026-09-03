import { addCreatedCampaign, createdCampaigns, type CreatedCampaign } from "@/server/overlay";
import { requireRole } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/merchant/campaigns
 *
 * Create a campaign from the console. It records what to suggest and how much
 * budget may be spent doing it — never a coupon. Only the seven dashboard
 * coupon ids can ever be attached to an order, and only the kernel picks one,
 * so `suggested_bps` here is a ceiling on what the store will ask for, not a
 * discount it can grant.
 */
const KINDS = new Set(["bought_together", "save_more", "bogo"]);

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return `cmp_${base === "" ? "campaign" : base}_${Date.now().toString(36).slice(-4)}`;
}

export async function GET(): Promise<Response> {
  const auth = await requireRole("merchant");
  if (!auth.ok) return auth.response;
  return Response.json({ campaigns: createdCampaigns() });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireRole("merchant");
  if (!auth.ok) return auth.response;

  let body: Partial<CreatedCampaign> & { budget_rupees?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (name === "") return Response.json({ error: "name is required" }, { status: 400 });

  const kind = String(body.kind ?? "bought_together");
  if (!KINDS.has(kind)) return Response.json({ error: "unknown campaign type" }, { status: 400 });

  const triggers = Array.isArray(body.trigger_sku_ids)
    ? body.trigger_sku_ids.filter((s): s is string => typeof s === "string" && s !== "")
    : [];
  if (triggers.length === 0) {
    return Response.json({ error: "pick at least one trigger product" }, { status: 400 });
  }

  const budget = Number(body.budget_paise ?? Math.round(Number(body.budget_rupees ?? 0) * 100));
  if (!Number.isFinite(budget) || budget <= 0) {
    return Response.json({ error: "budget must be greater than zero" }, { status: 400 });
  }

  // A suggestion above the top coupon is meaningless — the kernel would clamp
  // it anyway — so it is capped here where the merchant can see it happen.
  const suggested = Math.max(0, Math.min(2500, Math.round(Number(body.suggested_bps ?? 0))));

  const created = addCreatedCampaign({
    id: slug(name),
    name,
    kind: kind as CreatedCampaign["kind"],
    trigger_sku_ids: triggers,
    reward_sku_id: typeof body.reward_sku_id === "string" && body.reward_sku_id !== ""
      ? body.reward_sku_id
      : null,
    suggested_bps: suggested,
    budget_paise: Math.round(budget),
    starts_at: String(body.starts_at ?? new Date().toISOString()),
    ends_at: String(
      body.ends_at ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    ),
    active: true,
  });

  return Response.json({ campaign: created });
}
