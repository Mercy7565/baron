import { getSession, updateSession } from "@/server/acp";
import { baseUrl } from "@/lib/catalog";
import { lookupMandate, mandateRequiredResponse } from "@/server/mandates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /acp/checkout/:id/complete
 *
 * Runs the session through the same money path as everything else: an HTTP call
 * to /api/checkout/propose, which runs guardCart, then the kernel, then at most
 * one createOrder. ACP gets no privileged route to money.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = getSession(id);

  if (session === null) return Response.json({ error: "session not found" }, { status: 404 });

  // Cancelled and completed sessions are terminal.
  if (session.status !== "open") {
    return Response.json(
      { error: `session is ${session.status} and cannot be completed` },
      { status: 409 },
    );
  }

  // Re-checked at completion, not just at creation: a mandate can expire while
  // a session sits open.
  if (lookupMandate(session.mandate_hash) === null) {
    return mandateRequiredResponse("/cart");
  }

  if (session.items.length === 0) {
    return Response.json({ error: "session has no items" }, { status: 400 });
  }

  const res = await fetch(`${baseUrl()}/api/checkout/propose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cart_id: session.id,
      lines: session.items,
      currency: "INR",
      requested_discount_bps: session.requested_discount_bps,
      requested_offer_id: null,
      quoted_amount_paise: null,
      free_text: null,
      claimed_attributes: {},
      campaign_id: session.campaign_id,
      mandate_hash: session.mandate_hash,
    }),
  });

  const text = await res.text();
  let result: unknown;
  try {
    result = JSON.parse(text) as unknown;
  } catch {
    result = text;
  }

  const verdict = (result as { verdict?: { verdict?: string } }).verdict?.verdict ?? "UNKNOWN";

  // A refused proposal leaves the session open: the agent may fix the cart and
  // try again. Only a real order closes it.
  const completed = verdict === "ALLOW" || verdict === "CLAMP";

  const updated = updateSession(id, {
    status: completed ? "completed" : "open",
    result,
  });

  return Response.json({ session: updated, result }, { status: res.status });
}
