import { getQuote } from "@countersign/quotes";

import { issueLinkForQuote } from "@/server/checkout";
import { json, leaksSecret, preflight } from "@/server/gpt-shopper";
import { mintAndRegisterDemoIntent } from "@/server/mandates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = preflight;

/**
 * POST /api/gpt/pay  { quote_id }
 *
 * pay_quote — turn an agreed price into a Razorpay Payment Link.
 *
 * This is the boundary of the whole product. What the GPT gets back is a URL
 * and a set of ids. What it never gets, because none of it is ever put into the
 * body, is a card number, a CVV, a one-time code, a Razorpay secret, or the
 * contents of the shopper's wallet. The buyer completes the payment on
 * Razorpay's own page; the model does not see that page and could not act on it
 * if it did.
 *
 * "Pay" is also a slight misnomer, kept because it is the verb a model reaches
 * for. Nothing is captured here. A Payment Link is an invitation to pay, and it
 * stays unpaid — and visibly unpaid — until Razorpay says otherwise.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { quote_id?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "bad_request", message: "Body must be JSON with a `quote_id`." }, 400);
  }

  const quoteId = String(body.quote_id ?? "").trim();
  if (quoteId === "") {
    return json({ error: "bad_request", message: "Pass the quote_id from create_quote." }, 400);
  }

  const quote = getQuote(quoteId);
  if (quote === null) {
    return json(
      {
        error: "no_such_quote",
        message:
          "That quote is not on this server. Call create_quote again and show the shopper the new total before paying.",
      },
      404,
    );
  }

  /**
   * A mandate that resolves on this instance.
   *
   * The registry lives in memory, so a quote priced on one serverless instance
   * can reach `pay` on another and find its mandate gone. Minting here is the
   * same posture the existing outside-agent endpoint already takes for a caller
   * that brings none, and it keeps the intent check running rather than
   * skipping it.
   */
  const mandate = mintAndRegisterDemoIntent();

  const result = await issueLinkForQuote({
    quote_id: quoteId,
    mandate_hash: mandate.hash,
    presence: "agent",
  });

  if (result.status !== 200) {
    return json(
      {
        error: "not_payable",
        message:
          typeof result.body.reason === "string"
            ? result.body.reason
            : "This quote could not be turned into a payment link.",
        verdict: result.body.verdict ?? quote.verdict,
        razorpay_error: result.body.razorpay_error ?? null,
      },
      result.status,
    );
  }

  const b = result.body;
  const legal = Number(b.legal_total_paise ?? quote.legal_total_paise);

  const payload = {
    status: "ready_to_pay",
    quote_id: quoteId,
    verdict: b.verdict ?? quote.verdict,
    legal_total_paise: legal,
    legal_total_inr: legal / 100,
    applied_bps: b.applied_bps ?? quote.applied_bps,
    offer_id: b.offer_id ?? quote.offer_id,
    order_id: b.razorpay_order_id ?? null,
    payment_link_id: b.payment_link_id ?? null,
    short_url: b.short_url ?? null,
    idempotent_replay: b.idempotent_replay === true,
    paid: false,
    next_step:
      "Give the shopper short_url. They pay on Razorpay's page. Never ask them for a card number, a CVV or a one-time code — you cannot take a payment and must not appear to.",
  };

  /**
   * Belt and braces.
   *
   * Nothing above assembles a secret into the body, but this surface is the one
   * an untrusted model reads, so the claim is checked rather than asserted. A
   * leak becomes a 500 with no body rather than a 200 carrying the thing.
   */
  const leak = leaksSecret(payload);
  if (leak !== null) {
    return json({ error: "response_withheld", message: "Refusing to return that field." }, 500);
  }

  return json(payload);
}
