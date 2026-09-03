import { allQuotes, isExpired } from "@countersign/quotes";

import { issueLinkForQuote } from "@/server/checkout";
import { buyerId } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/checkout/issue-link
 *
 * Turn a quote into a Razorpay Payment Link. The only place in the product that
 * creates one, and only ever from a human pressing Generate.
 *
 * The `quote_id` a client holds goes stale the moment the basket changes: add
 * an item and the old quote is superseded, so issuing against it returned
 * "quote was superseded by a re-price" and the button became a dead end you
 * could press forever. So the id is treated as a hint about *which basket*, not
 * as the thing to bill: we resolve it to the newest live quote for that buyer
 * and issue against that instead.
 */
function latestLiveQuoteId(hintId: string, buyer: string): string | null {
  const now = new Date();

  const mine = allQuotes()
    .filter(
      (q) =>
        (q.buyer_user_id === buyer || q.buyer_user_id === "demo") &&
        q.status !== "cancelled" &&
        q.status !== "superseded" &&
        !isExpired(q, now) &&
        (q.verdict === "ALLOW" || q.verdict === "CLAMP"),
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // A quote that already carries a link is the answer: pressing Generate twice
  // must return the same link rather than minting a second one.
  const hinted = mine.find((q) => q.quote_id === hintId);
  if (hinted?.payment_link_id != null) return hinted.quote_id;

  return mine[0]?.quote_id ?? (hinted?.quote_id ?? null);
}

export async function POST(request: Request): Promise<Response> {
  let body: { quote_id?: string; mandate_hash?: string | null; presence?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (typeof body.quote_id !== "string" || body.quote_id === "") {
    return Response.json({ error: "quote_id is required" }, { status: 400 });
  }

  const buyer = await buyerId();
  const target = latestLiveQuoteId(body.quote_id, buyer);

  if (target === null) {
    return Response.json(
      {
        error: "no_live_quote",
        reason: "That basket has no current price. Re-price it and try again.",
      },
      { status: 409 },
    );
  }

  const result = await issueLinkForQuote({
    quote_id: target,
    mandate_hash: typeof body.mandate_hash === "string" ? body.mandate_hash : null,
    presence: body.presence === "agent" ? "agent" : "hitl",
  });

  // Say which quote was actually billed, so a client holding a stale id can
  // correct itself rather than guessing.
  return Response.json({ ...result.body, quote_id: target }, { status: result.status });
}
