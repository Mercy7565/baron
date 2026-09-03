import { cancelQuote, getQuote } from "@countersign/quotes";

import { requireRole } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/quotes/:id/cancel
 *
 * The buyer declining a price before any link exists.
 *
 * This is deliberately not the close-order path: there is nothing at Razorpay
 * to cancel, because nothing was created. It calls no Razorpay API, creates no
 * Payment Link, and cannot mark anything paid — it only takes the quote off the
 * buyer's unpaid list.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireRole("customer");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const quote = getQuote(id);
  if (quote === null) return Response.json({ error: "no such quote" }, { status: 404 });

  // A buyer may only cancel their own quote.
  if (quote.buyer_user_id !== auth.session.email && quote.buyer_user_id !== "demo") {
    return Response.json({ error: "not your quote" }, { status: 403 });
  }

  if (quote.payment_link_id !== null) {
    return Response.json(
      {
        error: "that quote already has a payment link — close the link instead",
        payment_link_id: quote.payment_link_id,
      },
      { status: 409 },
    );
  }

  const cancelled = cancelQuote(id);
  if (cancelled === null) {
    return Response.json(
      { error: "that quote cannot be cancelled", status: quote.status },
      { status: 409 },
    );
  }

  return Response.json({ quote_id: cancelled.quote_id, status: cancelled.status });
}
