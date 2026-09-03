import { proposeOrder } from "@/server/propose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/checkout/propose
 *
 * HTTP glue only. Every decision, every guard and the single createOrder call
 * live in `proposeOrder`, so the in-app agent, ACP, MCP and the link issuer all
 * go through exactly the same code — the issuer by calling it directly rather
 * than by fetching this route back over the network.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "body must be JSON", razorpay_calls_this_request: 0 },
      { status: 400 },
    );
  }

  const result = await proposeOrder(body);
  return Response.json(result.json, { status: result.status });
}
