import { getQuote } from "@countersign/quotes";
import { fetchPaymentLink, listPayments } from "@countersign/razorpay";

import { json, leaksSecret, preflight } from "@/server/gpt-shopper";
import { moneyLedger } from "@/server/money-rows";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = preflight;

/**
 * GET /api/gpt/payment?quote_id=…&payment_link_id=…
 *
 * get_payment — did the money actually move?
 *
 * The shopper asks "did that go through?" and the honest answer comes from
 * Razorpay, not from us. The local quote log lives in /tmp on a serverless
 * host, so a cold start can delete the record of a payment that very much
 * happened; answering "no such quote" there would be telling a buyer their
 * money did not move when it did.
 *
 * So the lookup degrades: the local quote first because it is cheapest and
 * knows the link id, then the Razorpay account, which is the only place that
 * can settle the question. Card fields do not appear because none are ever
 * assembled into the body.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const quoteId = (url.searchParams.get("quote_id") ?? "").trim();
  const linkIdParam = (url.searchParams.get("payment_link_id") ?? "").trim();

  if (quoteId === "" && linkIdParam === "") {
    return json(
      {
        error: "bad_request",
        message: "Pass quote_id or payment_link_id from create_quote or pay_quote.",
      },
      400,
    );
  }

  const creds = {
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
  };
  const haveCreds = creds.keyId !== "" && creds.keySecret !== "";

  // ---- what the local log still knows -------------------------------------
  const quote = quoteId === "" ? null : getQuote(quoteId);
  let linkId = linkIdParam === "" ? (quote?.payment_link_id ?? null) : linkIdParam;
  let shortUrl = quote?.payment_link_short_url ?? null;
  let expectedPaise = quote?.legal_total_paise ?? null;

  // ---- what Razorpay says, which is the part that decides ------------------
  let paid = false;
  let capturedPaise: number | null = null;
  let payId: string | null = null;
  let live = false;
  let error: string | null = null;

  if (haveCreds && linkId !== null) {
    const res = await fetchPaymentLink(creds, linkId);
    if (res.ok) {
      live = true;
      shortUrl = res.data.short_url ?? shortUrl;
      const captured = (res.data.payments ?? []).find(
        (p) => p.status === "captured" && typeof p.payment_id === "string",
      );
      if (captured?.payment_id !== undefined) {
        payId = captured.payment_id;
        paid = true;
      }
      paid = paid || res.data.status === "paid";
    } else {
      error = res.error;
    }
  }

  /**
   * The captured figure, and the fallback when the log is gone.
   *
   * A link reports the amount it was raised for, not what was taken — those are
   * deliberately different now that the coupon is applied by Razorpay — so the
   * captured number has to come from the payment itself.
   */
  if (haveCreds && (paid || linkId === null)) {
    const payments = await listPayments(creds, 100);
    if (payments.ok) {
      live = true;
      const hit =
        payId !== null
          ? payments.data.find((p) => p.id === payId)
          : // No link to go on: fall back to the merged ledger, which can tie a
            // payment back to a quote through the link's notes.
            undefined;
      if (hit !== undefined) capturedPaise = hit.amount;
    } else if (error === null) {
      error = payments.error;
    }
  }

  // Still nothing, and we were given a quote id: ask the merged ledger, which
  // reads the account and folds in whatever the log has left.
  if (capturedPaise === null && quoteId !== "" && haveCreds) {
    const ledger = await moneyLedger();
    const row = ledger.rows.find(
      (r) => r.quote_id === quoteId || (linkId !== null && r.payment_link_id === linkId),
    );
    if (row !== undefined) {
      live = live || ledger.live;
      linkId = linkId ?? row.payment_link_id;
      shortUrl = shortUrl ?? row.short_url;
      if (row.status === "paid") {
        paid = true;
        capturedPaise = row.amount_paise;
        payId = payId ?? row.payment_id;
      }
      expectedPaise = expectedPaise ?? row.order_amount_paise;
    }
  }

  const payload = {
    quote_id: quoteId === "" ? null : quoteId,
    payment_link_id: linkId,
    paid,
    legal_total_paise: expectedPaise,
    legal_total_inr: expectedPaise === null ? null : expectedPaise / 100,
    captured_paise: capturedPaise,
    captured_inr: capturedPaise === null ? null : capturedPaise / 100,
    pay_id: payId,
    // Only worth showing while there is still something to pay.
    short_url: paid ? null : shortUrl,
    source: live ? "razorpay" : "local",
    error,
    next_step: paid
      ? "Tell the shopper the payment went through and give them the captured amount."
      : linkId === null
        ? "No payment link exists for this quote yet. Call pay_quote first."
        : "Not paid yet. Give the shopper short_url again; do not ask them for card details.",
  };

  const leak = leaksSecret(payload);
  if (leak !== null) {
    return json({ error: "response_withheld", message: "Refusing to return that field." }, 500);
  }

  return json(payload);
}
