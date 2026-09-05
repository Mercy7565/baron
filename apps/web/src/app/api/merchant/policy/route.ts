import { DEFAULT_MARGIN_FLOOR_BPS } from "@/lib/policy";
import { marginFloorBps, setMarginFloorBps, hydrateOverlay, persistOverlay } from "@/server/overlay";
import { requireRole } from "@/server/require-role";
import { durability } from "@/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET/POST /api/merchant/policy
 *
 * The one policy number a merchant may turn: the margin they want protected.
 *
 * It writes to the same overlay the quote path reads on every request, so the
 * next quote uses the new floor — no restart, and no second copy of the policy
 * to drift out of sync.
 */
export async function GET(): Promise<Response> {
  // Merchant state is durable and shared; pull it into this instance
  // before anything reads a campaign, a catalog edit or the margin floor.
  await hydrateOverlay();

  const auth = await requireRole("merchant");
  if (!auth.ok) return auth.response;

  const saved = await persistOverlay();
  return Response.json({
    saved,
    storage: durability(),
    margin_floor_bps: marginFloorBps(DEFAULT_MARGIN_FLOOR_BPS),
    default_margin_floor_bps: DEFAULT_MARGIN_FLOOR_BPS,
  });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireRole("merchant");
  if (!auth.ok) return auth.response;

  let body: { margin_floor_bps?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const asked = Number(body.margin_floor_bps);
  if (!Number.isFinite(asked)) {
    return Response.json({ error: "margin_floor_bps must be a number" }, { status: 400 });
  }

  const saved = setMarginFloorBps(asked);

  return Response.json({
    margin_floor_bps: saved,
    // Reported so the console can say "we clamped that" rather than silently
    // storing something different from what was dragged.
    clamped: saved !== Math.round(asked),
  });
}
