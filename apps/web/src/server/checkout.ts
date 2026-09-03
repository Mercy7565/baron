import { appendAuditRecord } from "@countersign/ledger";
import { checkAgainstIntent } from "@countersign/mandates";
import { getQuote, updateQuote } from "@countersign/quotes";
import { appendOrder } from "@countersign/orders";
import { createPaymentLink } from "@countersign/razorpay";
import { Wallet } from "@countersign/vault";

import { lookupMandate } from "@/server/mandates";
import { proposeOrder } from "@/server/propose";

/**
 * Issue a Razorpay Payment Link for an approved quote.
 *
 * This is where an agent-driven purchase ends: the agent gets a link, the buyer
 * pays it. The agent never sees a card or a step-up code, because it never
 * touches either — the link is a URL, and the payment happens on Razorpay's own
 * page (or on /gate).
 *
 * This is the only money path in the repo. There is no server-to-server charge
 * and no simulated capture: Razorpay has no headless card API on this account,
 * so the buyer completes the link themselves.
 */

export interface IssueLinkResult {
  status: number;
  body: Record<string, unknown>;
}

function refuse(reason: string, extra: Record<string, unknown> = {}): IssueLinkResult {
  return {
    status: 403,
    body: { error: "not_payable", reason, razorpay_calls_this_request: 0, ...extra },
  };
}

export async function issueLinkForQuote(input: {
  quote_id: string;
  mandate_hash: string | null;
  presence: "agent" | "hitl";
}): Promise<IssueLinkResult> {
  const quote = getQuote(input.quote_id);
  if (quote === null) return refuse("no such quote");

  // Idempotent: a quote that already has a link keeps it.
  if (quote.payment_link_id !== null && quote.payment_link_short_url !== null) {
    return {
      status: 200,
      body: {
        status: "ready_to_pay",
        quote_id: quote.quote_id,
        payment_link_id: quote.payment_link_id,
        short_url: quote.payment_link_short_url,
        legal_total_paise: quote.legal_total_paise,
        verdict: quote.verdict,
        applied_bps: quote.applied_bps,
        offer_id: quote.offer_id,
        razorpay_order_id: quote.order_id,
        idempotent_replay: true,
      },
    };
  }

  if (quote.status === "superseded") return refuse("quote was superseded by a re-price");

  if (quote.verdict !== "ALLOW" && quote.verdict !== "CLAMP") {
    return refuse(`verdict ${quote.verdict} is not payable`, { verdict: quote.verdict });
  }

  const bundle = lookupMandate(input.mandate_hash ?? quote.mandate_hash);
  if (bundle === null) return refuse("mandate missing or expired");

  const intentCheck = checkAgainstIntent(
    bundle.intent,
    quote.legal_total_paise,
    quote.applied_bps,
    quote.lines.map((l) => l.sku_id),
    new Date(),
  );
  if (!intentCheck.valid) return refuse(intentCheck.message);

  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  if (keyId === "" || keySecret === "") {
    return { status: 500, body: { error: "Razorpay credentials are not configured" } };
  }

  // --- the order ----------------------------------------------------------
  //
  // Called in-process, not fetched over loopback. Still the only createOrder
  // call site in the repo — the HTTP route is a wrapper over this same
  // function. See the note on proposeOrder for why the loopback had to go.
  const proposed = await proposeOrder({
    cart_id: quote.quote_id,
    lines: quote.lines.map((l) => ({ sku_id: l.sku_id, qty: l.qty })),
    currency: "INR",
    requested_discount_bps: quote.applied_bps,
    requested_offer_id: null,
    quoted_amount_paise: null,
    free_text: null,
    claimed_attributes: {},
    campaign_id: quote.campaign_id,
    mandate_hash: input.mandate_hash ?? quote.mandate_hash,
  });

  const propose = proposed.json;
  const order = (propose.order ?? null) as { id?: string } | null;

  if (order === null || typeof order.id !== "string") {
    // Say what actually stopped it. A verdict when the kernel refused, the
    // error slug when the mandate or Razorpay did, and the HTTP status either
    // way — never a bare "unknown", which told nobody anything.
    const verdict = (propose.verdict ?? null) as { verdict?: string; reasons?: { message?: string } } | null;
    const slug = typeof propose.error === "string" ? propose.error : null;
    const detail =
      verdict?.reasons?.message ??
      (typeof propose.razorpay_error === "string" ? propose.razorpay_error : null);

    const why =
      verdict?.verdict !== undefined
        ? `policy returned ${verdict.verdict}${detail === null ? "" : ` — ${detail}`}`
        : slug !== null
          ? `${slug}${detail === null ? "" : ` — ${detail}`}`
          : `propose returned HTTP ${proposed.status} with no order`;

    return refuse(`could not create the Razorpay order: ${why}`, {
      verdict: verdict?.verdict ?? null,
      propose_status: proposed.status,
      propose_error: slug,
    });
  }

  // --- the link -----------------------------------------------------------

  const link = await createPaymentLink(
    { keyId, keySecret },
    {
      amount_paise: quote.legal_total_paise,
      description: `Order ${quote.quote_id}`,
      reference_id: `${quote.quote_id}-${Date.now().toString(36)}`,
      notes: {
        decision_id: quote.decision_id ?? "",
        quote_id: quote.quote_id,
        order_id: order.id,
      },
    },
  );

  // A failed link is reported with Razorpay's own words. We never invent one.
  if (!link.ok) {
    return {
      status: 502,
      body: {
        error: "payment_link_failed",
        razorpay_error: link.error,
        razorpay_status: link.status,
        razorpay_order_id: order.id,
        quote_id: quote.quote_id,
      },
    };
  }

  // A wallet is optional here: the buyer can pay the link on Razorpay's page.
  const walletToken = new Wallet().getToken(quote.buyer_user_id);

  // Budget is NOT burned here. A Payment Link is an invitation, not revenue,
  // and a campaign whose budget drained every time a shopper asked for a price
  // would run out on chat alone. Spend is recorded when Razorpay confirms the
  // payment — see /api/orders/refresh.
  const discountPaise = quote.subtotal_paise - quote.legal_total_paise;

  // The order exists the moment a link does, but it is not revenue yet.
  appendOrder({
    order_id: quote.quote_id,
    quote_id: quote.quote_id,
    buyer_user_id: quote.buyer_user_id,
    agent_id: quote.agent_id,
    razorpay_order_id: order.id,
    payment_link_id: link.data.id,
    short_url: link.data.short_url,
    amount_paise: quote.legal_total_paise,
    asked_bps: quote.asked_bps,
    applied_bps: quote.applied_bps,
    offer_id: quote.offer_id,
    verdict: quote.verdict,
    lines: quote.lines.map((l) => ({
      sku_id: l.sku_id,
      title: l.title,
      qty: l.qty,
      line_total_paise: l.line_total_paise,
    })),
    ...(quote.gift_lines === undefined || quote.gift_lines.length === 0
      ? {}
      : { gift_lines: quote.gift_lines }),
    ...(quote.line_origins === undefined ? {} : { line_origins: quote.line_origins }),
    status: "awaiting_payment",
    razorpay_payment_id: null,
    created_at: new Date().toISOString(),
    paid_at: null,
  });

  updateQuote(quote.quote_id, {
    status: "link_issued",
    order_id: order.id,
    payment_link_id: link.data.id,
    payment_link_short_url: link.data.short_url,
  });

  appendAuditRecord({
    kind: "payment",
    decision_id: quote.decision_id,
    order_id: order.id,
    payment_id: null,
    event_id: null,
    verdict: quote.verdict,
    offer_id: quote.offer_id,
    attached_ok: quote.offer_id !== null,
    webhook_status: "link_issued",
    schema_version: 2,
    quote_id: quote.quote_id,
    agent_id: quote.agent_id,
    // last4 only when a card is actually on file. Never a PAN, never a token id.
    last4: walletToken?.last4 ?? null,
    presence: input.presence,
    capture_mode: "payment_link",
  });

  return {
    status: 200,
    body: {
      status: "ready_to_pay",
      quote_id: quote.quote_id,
      payment_link_id: link.data.id,
      short_url: link.data.short_url,
      legal_total_paise: quote.legal_total_paise,
      verdict: quote.verdict,
      applied_bps: quote.applied_bps,
      offer_id: quote.offer_id,
      razorpay_order_id: order.id,
      campaign_id: quote.campaign_id,
      discount_paise: discountPaise,
      last4: walletToken?.last4 ?? null,
      wallet_on_file: walletToken !== null,
      // No capture happened here, so there is no OTP to have handled.
      capture: "payment_link",
      vault_charged: false,
      idempotent_replay: false,
      razorpay_calls_this_request: 2,
    },
  };
}
