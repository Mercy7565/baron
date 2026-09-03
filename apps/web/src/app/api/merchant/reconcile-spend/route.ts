import { allOrders } from "@countersign/orders";

import { reconcileCampaignSpend } from "@/server/burn";
import { setReconciledSpend } from "@/server/overlay";
import { requireRole } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/merchant/reconcile-spend
 *
 * Rebuild every campaign's spend from the paid orders on disk.
 *
 * A repair, not a routine: the burn wrote one store while the console read
 * another, leaving figures that match nothing. This recomputes each campaign's
 * cost from the gifts it gave and the suggestions shoppers took on confirmed
 * payments, and rewrites the idempotency ledger so ordinary burns carry on
 * correctly afterwards.
 */
export async function POST(): Promise<Response> {
  const auth = await requireRole("merchant");
  if (!auth.ok) return auth.response;

  const { totals, burned } = reconcileCampaignSpend(allOrders());
  setReconciledSpend(totals, burned);

  return Response.json({ totals, payments_counted: burned.length });
}
