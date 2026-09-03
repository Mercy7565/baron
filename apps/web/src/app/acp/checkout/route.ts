import { createSession } from "@/server/acp";
import { lookupMandate, mandateRequiredResponse } from "@/server/mandates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /acp/checkout — create a session. Requires a mandate up front. */
export async function POST(request: Request): Promise<Response> {
  let body: {
    items?: Array<{ sku_id: string; qty: number }>;
    requested_discount_bps?: number;
    mandate_hash?: string;
    campaign_id?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  // x402-shaped gate, identical to the propose route's.
  if (lookupMandate(body.mandate_hash) === null) {
    return mandateRequiredResponse("/cart");
  }

  const session = createSession({
    items: Array.isArray(body.items) ? body.items : [],
    requested_discount_bps: body.requested_discount_bps ?? 0,
    mandate_hash: body.mandate_hash ?? "",
    campaign_id: body.campaign_id ?? null,
  });

  return Response.json({ session }, { status: 201 });
}
