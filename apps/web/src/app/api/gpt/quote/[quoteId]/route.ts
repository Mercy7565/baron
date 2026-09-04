import { getQuote, isExpired } from "@countersign/quotes";

import { json, preflight } from "@/server/gpt-shopper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = preflight;

/**
 * GET /api/gpt/quote/{quoteId}
 *
 * get_quote — read a price back without changing anything.
 *
 * Useful when the conversation wandered: the shopper went away, came back, and
 * the model needs to know whether the number it quoted is still the number. An
 * expired quote is reported as expired rather than silently re-priced, because
 * quietly moving a price the shopper has already been told is the behaviour
 * this whole system exists to make impossible.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ quoteId: string }> },
): Promise<Response> {
  const { quoteId } = await params;

  const quote = getQuote(quoteId);
  if (quote === null) {
    return json(
      {
        error: "no_such_quote",
        message:
          "That quote is not on this server. Price the basket again with create_quote before telling the shopper anything.",
      },
      404,
    );
  }

  const expired = isExpired(quote, new Date());

  return json({
    quote_id: quote.quote_id,
    status: expired ? "expired" : quote.status,
    verdict: quote.verdict,
    subtotal_paise: quote.subtotal_paise,
    legal_total_paise: quote.legal_total_paise,
    legal_total_inr: quote.legal_total_paise / 100,
    asked_bps: quote.asked_bps,
    applied_bps: quote.applied_bps,
    offer_id: quote.offer_id,
    lines: quote.lines.map((l) => ({
      sku_id: l.sku_id,
      title: l.title,
      qty: l.qty,
      line_total_paise: l.line_total_paise,
    })),
    // Gifts are shipped and never priced, so they are shown apart from lines.
    gift_lines: (quote.gift_lines ?? []).map((g) => ({
      sku_id: g.sku_id,
      title: g.title,
      qty: g.qty,
      free: true,
    })),
    expires_at: quote.expires_at,
    payable: !expired && (quote.verdict === "ALLOW" || quote.verdict === "CLAMP"),
    payment_link_id: quote.payment_link_id,
    short_url: quote.payment_link_short_url,
  });
}
