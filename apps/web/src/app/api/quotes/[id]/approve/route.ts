import { priceCart, productById } from "@countersign/catalog";
import { evaluate } from "@countersign/kernel";
import { buildOrderNotes } from "@countersign/ledger";
import {
  type Quote,
  QUOTE_TTL_MS,
  appendQuote,
  computeLegalTotal,
  getQuote,
  isExpired,
  quoteId,
  updateQuote,
} from "@countersign/quotes";

import { CATALOG } from "@/lib/catalog";
import { DEV_POLICY } from "@/lib/policy";

/** The rung the kernel actually chose, so its rupee cap can be enforced. */
function chosenRung(offerIds: string[]) {
  const id = offerIds[0];
  return id === undefined ? null : (DEV_POLICY.ladder.find((r) => r.offer_id === id) ?? null);
}


export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/quotes/:id/approve
 *
 * Re-reads the catalog and re-runs the kernel before letting a human commit. A
 * quote is a promise about a world that may have moved: if stock, price or
 * verdict changed, the promise is void and we hand back a fresh one rather than
 * honouring a stale number.
 *
 * Razorpay is never called here.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const quote = getQuote(id);

  if (quote === null) {
    return Response.json({ error: "no such quote" }, { status: 404 });
  }

  if (isExpired(quote, new Date())) {
    return Response.json(
      { error: "quote_expired", expires_at: quote.expires_at, razorpay_calls_this_request: 0 },
      { status: 410 },
    );
  }

  if (quote.status === "superseded") {
    return Response.json(
      {
        error: "quote_superseded",
        new_quote_id: quote.superseded_by,
        razorpay_calls_this_request: 0,
      },
      { status: 409 },
    );
  }

  // ------------------------------------------------------- re-read the world

  const lines = quote.lines.map((l) => ({ sku_id: l.sku_id, qty: l.qty }));

  const changes: string[] = [];
  for (const line of quote.lines) {
    const product = productById(CATALOG, line.sku_id);
    if (product === null) {
      changes.push(`${line.sku_id} is no longer in the catalog`);
      continue;
    }
    if (product.price_paise !== line.unit_price_paise) {
      changes.push(
        `${line.sku_id} price moved ${line.unit_price_paise} -> ${product.price_paise}`,
      );
    }
    if (product.availability !== "in_stock" || product.stock_qty < line.qty) {
      changes.push(`${line.sku_id} stock is now ${product.stock_qty} (${product.availability})`);
    }
  }

  const cart = priceCart(CATALOG, lines);

  const proposal = {
    cart_id: quote.quote_id,
    amount_paise: cart.amount_paise,
    currency: "INR" as const,
    requested_discount_bps: quote.asked_bps,
    requested_offer_id: null,
    product_ids: cart.product_ids,
    margin_bps: cart.margin_bps,
  };

  const verdict = evaluate(proposal, DEV_POLICY);

  if (verdict.verdict !== quote.verdict) {
    changes.push(`verdict moved ${quote.verdict} -> ${verdict.verdict}`);
  }
  if (verdict.applied_discount_bps !== quote.applied_bps) {
    changes.push(`applied discount moved ${quote.applied_bps} -> ${verdict.applied_discount_bps}`);
  }

  // --------------------------------------------------------- supersede or ok

  if (changes.length > 0) {
    const now = new Date();

    const quoteLines = cart.lines.map((l) => ({
      sku_id: l.sku_id,
      title: l.title,
      qty: l.qty,
      unit_price_paise: l.unit_price_paise,
      line_total_paise: l.line_total_paise,
    }));

    const { subtotal_paise, legal_total_paise } = computeLegalTotal(
    quoteLines,
    verdict.applied_discount_bps,
    chosenRung(verdict.offer_ids)?.max_discount_paise ?? null,
  );

    const newId = quoteId(`${quote.quote_id}:reprice:${now.toISOString()}`);

    const notes = buildOrderNotes(proposal, DEV_POLICY, verdict, {
      ...(quote.campaign_id === null ? {} : { campaign_id: quote.campaign_id }),
      quote_id: newId,
    });

    const replacement: Quote = {
      ...quote,
      quote_id: newId,
      status: "quoted",
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
      lines: quoteLines,
      subtotal_paise,
      legal_total_paise,
      applied_bps: verdict.applied_discount_bps,
      offer_id: verdict.offer_ids[0] ?? null,
      decision_id: notes.decision_id,
      verdict: verdict.verdict,
      payment_id: null,
      order_id: null,
      superseded_by: null,
      ignored_inputs: [...quote.ignored_inputs],
      mistakes_repaired: [...quote.mistakes_repaired],
    };

    appendQuote(replacement);
    updateQuote(quote.quote_id, { status: "superseded", superseded_by: newId });

    return Response.json(
      {
        new_quote_id: newId,
        reason: "price_or_stock_changed",
        changes,
        legal_total_paise: replacement.legal_total_paise,
        applied_bps: replacement.applied_bps,
        offer_id: replacement.offer_id,
        verdict: replacement.verdict,
        expires_at: replacement.expires_at,
        razorpay_calls_this_request: 0,
      },
      { status: 409 },
    );
  }

  const approved = updateQuote(quote.quote_id, { status: "approved" });

  return Response.json(
    {
      quote_id: quote.quote_id,
      status: approved?.status ?? "approved",
      legal_total_paise: quote.legal_total_paise,
      applied_bps: quote.applied_bps,
      offer_id: quote.offer_id,
      verdict: quote.verdict,
      expires_at: quote.expires_at,
      razorpay_calls_this_request: 0,
    },
    { status: 200 },
  );
}
