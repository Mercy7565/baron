import { allOrders } from "@countersign/orders";
import { allQuotes, isExpired } from "@countersign/quotes";

import { POST as createQuote } from "@/app/api/quotes/route";
import { POST as approveQuote } from "@/app/api/quotes/[id]/approve/route";
import { issueLinkForQuote } from "@/server/checkout";
import { payable, readBasket } from "@/server/cart";
import { enteredCode } from "@/server/shop-code";
import { cartFingerprint } from "@/server/fingerprint";
import { mintAndRegisterDemoIntent } from "@/server/mandates";
import { buyerId } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/checkout/pay
 *
 * One click: price the basket in front of us, then create the Payment Link for
 * that price. Nothing else.
 *
 * The old two-step — hold a quote id in the browser, then issue against it —
 * had a failure that reached a shopper: when the newest quote could not be
 * billed, the server fell back to the newest *usable* quote, which belonged to
 * a different basket. A ₹3,096 cart opened a ₹2,292 link. The basket is now the
 * only input, and the link is bound to that basket's fingerprint, so a link can
 * never describe a bag other than the one it was made for.
 */
export async function POST(request: Request): Promise<Response> {
  const buyer = await buyerId();

  let body: { cart_id?: string; mandate_hash?: string | null } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // No body is fine; the demo cart is the default.
  }

  // Gifts never reach the money path: the amount is the charged lines only.
  // The bag is this browser's cookie, so this prices exactly what the shopper
  // is looking at rather than whatever a shared server map happened to hold.
  const bag = await readBasket(await enteredCode());
  const lines = payable(bag);

  /**
   * An empty bag stops here, before Razorpay is touched at all.
   *
   * Not an oversight to guard against — a real click. The Pay button is on a
   * page whose contents can go to zero while it is open, and asking a payment
   * provider to bill nothing is both an error and a wasted call against an
   * account with a lifetime link cap.
   */
  if (lines.length === 0) {
    return Response.json(
      { error: "empty_basket", message: "Your bag is empty, so there is nothing to pay for." },
      { status: 400 },
    );
  }

  const fingerprint = cartFingerprint(lines);
  const now = new Date();

  /**
   * The gifts currently in the bag, as a comparable key.
   *
   * The cart fingerprint deliberately ignores gifts — a gift must never move
   * the price. But that makes a gift-less quote an exact fingerprint match for
   * a bag that has gifts, so reusing one billed the right amount and then wrote
   * an order with the gift missing. Reuse now requires the gifts to match too.
   */
  const giftKey = bag
    .filter((l) => l.gift === true)
    .map((l) => `${l.sku_id}:${l.qty}:${l.from_campaign_id ?? ""}`)
    .sort()
    .join("|");

  const quoteGiftKey = (q: { gift_lines?: Array<{ sku_id: string; qty: number; from_campaign_id: string | null }> }): string =>
    (q.gift_lines ?? [])
      .map((g) => `${g.sku_id}:${g.qty}:${g.from_campaign_id ?? ""}`)
      .sort()
      .join("|");

  /**
   * A link already made for this exact bag, and still payable.
   *
   * Pressing Pay twice on the same bag must return the same link rather than
   * minting a second one. A link whose order has been *paid* is retired: it is
   * finished, and handing it back would show a shopper a Razorpay page that is
   * already complete, which reads as "we lost your money".
   */
  const settled = new Set(
    allOrders()
      .filter((o) => o.status === "paid" || o.status === "closed")
      .map((o) => o.quote_id),
  );

  const existing = allQuotes()
    .filter(
      (q) =>
        q.cart_fingerprint === fingerprint &&
        (q.buyer_user_id === buyer || q.buyer_user_id === "demo") &&
        q.payment_link_id !== null &&
        q.payment_link_short_url !== null &&
        q.status !== "cancelled" &&
        !settled.has(q.quote_id) &&
        quoteGiftKey(q) === giftKey,
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

  if (existing !== undefined) {
    return Response.json({
      status: "ready_to_pay",
      quote_id: existing.quote_id,
      payment_link_id: existing.payment_link_id,
      short_url: existing.payment_link_short_url,
      total_paise: existing.legal_total_paise,
      coupon_bps: existing.applied_bps,
      offer_id: existing.offer_id,
      cart_fingerprint: fingerprint,
      idempotent_replay: true,
    });
  }

  // A live quote for exactly this basket, or a fresh one.
  const mandateHash =
    typeof body.mandate_hash === "string" && body.mandate_hash !== ""
      ? body.mandate_hash
      : mintAndRegisterDemoIntent().hash;

  const reusable = allQuotes()
    .filter(
      (q) =>
        q.cart_fingerprint === fingerprint &&
        !settled.has(q.quote_id) &&
        (q.buyer_user_id === buyer || q.buyer_user_id === "demo") &&
        q.status !== "cancelled" &&
        q.status !== "superseded" &&
        !isExpired(q, now) &&
        quoteGiftKey(q) === giftKey &&
        (q.verdict === "ALLOW" || q.verdict === "CLAMP"),
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

  let quoteId = reusable?.quote_id ?? null;

  if (quoteId === null) {
    /**
     * Priced in process, not over loopback.
     *
     * This used to `fetch` its own /api/quotes. On a serverless host that
     * second request can land on a different instance — and the mandate minted
     * a few lines above lives in this instance's memory, so the other one
     * answered 402 and the shopper was told "we could not price that bag"
     * about a perfectly ordinary basket. Same failure the propose path had, and
     * the same fix: call the handler, do not phone it.
     */
    const inner = new Request("https://baron.internal/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: request.headers.get("cookie") ?? "" },
      body: JSON.stringify({
        buyer_user_id: buyer,
        agent_id: "cart",
        mandate_hash: mandateHash,
        // Paid lines carry where they came from; gifts travel beside them so
        // the order records what was actually in the box.
        sku_lines: bag
          .filter((l) => l.gift !== true)
          .map((l) => ({
            sku_id: l.sku_id,
            qty: l.qty,
            ...(l.from_campaign_id === undefined ? {} : { from_campaign_id: l.from_campaign_id }),
          })),
        gift_lines: bag
          .filter((l) => l.gift === true)
          .map((l) => ({
            sku_id: l.sku_id,
            qty: l.qty,
            from_campaign_id: l.from_campaign_id ?? null,
          })),
      }),
    });

    const priced = (await (await createQuote(inner)).json()) as {
      quote_id?: string | null;
      reason?: string;
    };

    if (priced.quote_id == null) {
      return Response.json(
        { error: priced.reason ?? "We could not price that bag." },
        { status: 409 },
      );
    }
    quoteId = priced.quote_id;
  }

  // Also in process, for the same reason.
  await approveQuote(new Request("https://baron.internal/approve", { method: "POST" }), {
    params: Promise.resolve({ id: quoteId }),
  });

  const issued = await issueLinkForQuote({
    quote_id: quoteId,
    mandate_hash: mandateHash,
    presence: "hitl",
  });

  return Response.json(
    { ...issued.body, cart_fingerprint: fingerprint },
    { status: issued.status },
  );
}
