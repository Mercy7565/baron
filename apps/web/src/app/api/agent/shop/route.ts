import { cookies } from "next/headers";

import { priceCart } from "@countersign/catalog";
import { signResume, verifyResume } from "@countersign/resume";

import { CATALOG } from "@/lib/catalog";
import { recommend } from "@/server/recommend";
import { resolveSku } from "@/server/tools";
import { lookupMandate, mintAndRegisterDemoIntent } from "@/server/mandates";
import { SESSION_COOKIE, decodeSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A Custom GPT calls this from OpenAI's infrastructure, so the browser-facing
 * origins have to be allowed explicitly. Nothing here is authenticated by
 * origin — the mandate and the kernel are what actually gate money.
 */
const ALLOWED_ORIGINS = new Set(["https://chatgpt.com", "https://chat.openai.com"]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin !== null && ALLOWED_ORIGINS.has(origin) ? origin : "https://chatgpt.com";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

export function OPTIONS(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

/**
 * POST /api/agent/shop
 *
 * The whole outside-agent surface, in two rounds.
 *
 *   round 1  { intent_text }                      -> need_upsell_decision | ready_to_pay
 *   round 2  { resume_token, accept_upsell }      -> ready_to_pay
 *
 * The second round is the last human contact: a yes or a no. After that the
 * agent has a Payment Link and nothing else to decide. It never receives a card
 * number or a step-up code, because it never touches either — the buyer pays on
 * Razorpay's page.
 */

/**
 * Turn a spoken request into a product query.
 *
 * A shopper talking to a GPT says "buy me niacinamide from Baron", and the
 * GPT passes that through verbatim. The store name and the leading verb are
 * conversation, not product words — left in, they drag the match below the
 * resolver's confidence bar and a real product reads as not found.
 *
 * This only strips framing. It never adds a term and never widens the search,
 * so an invented product is still an invented product.
 */
function normaliseIntent(intent: string): string {
  return intent
    .replace(/^\s*(?:can you\s+|please\s+)?(?:buy|get|order|find|purchase)\s+(?:me\s+)?(?:the\s+|a\s+|an\s+|some\s+)?/i, "")
    // "... from Baron", "... at the Baron store". The old name stays matched so
    // links and transcripts written before the rename still resolve.
    .replace(
      /\s+(?:from|at|on|in)\s+(?:the\s+)?(?:baron|northlight|store|shop)(?:\s+(?:store|shop|site))?\s*$/i,
      "",
    )
    .replace(/\s+(?:please|thanks|thank you)\s*$/i, "")
    .replace(/[.!?]+\s*$/, "")
    .trim();
}

/**
 * Quote a set of lines and hand back the price. No link is created here.
 *
 * An outside agent finishing a sentence is not a human deciding to pay, so this
 * stops at the quote: the total, the coupon that policy actually allowed, and a
 * URL where the buyer generates the Payment Link themselves. Creating a real
 * object in a real Razorpay account is reserved for that click.
 */
async function toQuote(
  origin: string,
  lines: Array<{ sku_id: string; qty: number }>,
  mandateHash: string,
  buyerUserId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const quoteRes = await fetch(`${origin}/api/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      buyer_user_id: buyerUserId,
      agent_id: "outside_shopper_ai",
      mandate_hash: mandateHash,
      sku_lines: lines,
      // Deliberately no requested_discount_bps: the store gives this basket the
      // best coupon it can clear. An outside agent demanding a figure is what a
      // CLAMP is for, and this is the store's own path, not that.
    }),
  });

  const quote = (await quoteRes.json()) as {
    quote_id?: string | null;
    verdict?: string;
    reason?: string;
    legal_total_paise?: number;
    subtotal_paise?: number;
    applied_bps?: number;
    offer_id?: string | null;
    mistakes_repaired?: string[];
    ignored_inputs?: string[];
  };

  // A refused basket never becomes a link.
  if (quote.quote_id == null) {
    return {
      status: 200,
      body: {
        status: "refused",
        verdict: quote.verdict ?? "REJECT",
        reason: quote.reason ?? "policy refused this basket",
        mistakes_repaired: quote.mistakes_repaired ?? [],
        ignored_inputs: quote.ignored_inputs ?? [],
        payment_link_id: null,
        short_url: null,
      },
    };
  }

  await fetch(`${origin}/api/quotes/${quote.quote_id}/approve`, { method: "POST" });

  return {
    status: 200,
    body: {
      status: "ready_to_generate",
      quote_id: quote.quote_id,
      legal_total_paise: quote.legal_total_paise ?? null,
      subtotal_paise: quote.subtotal_paise ?? null,
      applied_bps: quote.applied_bps ?? 0,
      offer_id: quote.offer_id ?? null,
      verdict: quote.verdict ?? null,
      // Where the human generates the link. Nothing has been created yet.
      generate_url: `${origin}/orders?tab=unpaid`,
      payment_link_id: null,
      short_url: null,
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const cors = corsHeaders(request.headers.get("origin"));

  // If the caller happens to carry our customer cookie, the order is attributed
  // to that email. A Custom GPT has no cookie, and must still be able to shop —
  // so this is an enrichment, never a requirement.
  const jar = await cookies();
  const session = await decodeSession(jar.get(SESSION_COOKIE)?.value);
  const buyer = session !== null && session.role === "customer" ? session.email : "demo";

  let body: {
    intent_text?: string;
    mandate_hash?: string | null;
    resume_token?: string;
    accept_upsell?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400, headers: cors });
  }

  // ------------------------------------------------------------------ round 2

  if (typeof body.resume_token === "string" && body.resume_token !== "") {
    // The token carries its own state and is verified by signature, so any
    // instance can complete round 2 — no shared disk, no sticky sessions.
    const verified = await verifyResume(body.resume_token);

    if (!verified.ok) {
      return Response.json(
        {
          status: "expired",
          error: `resume_token ${verified.reason}`,
          payment_link_id: null,
          short_url: null,
        },
        { status: verified.reason === "expired" ? 410 : 400, headers: cors },
      );
    }

    const { payload } = verified;

    // Accept adds the top suggestion; reject quotes exactly what was there.
    const top = payload.suggestions[0];
    const lines =
      body.accept_upsell === true && top !== undefined
        ? [...payload.lines, { sku_id: top.sku_id, qty: 1 }]
        : payload.lines;

    const result = await toQuote(origin, lines, payload.mandate_hash, buyer);
    return Response.json(
      { ...result.body, upsell_accepted: body.accept_upsell === true },
      { status: result.status, headers: cors },
    );
  }

  // ------------------------------------------------------------------ round 1

  const intent = String(body.intent_text ?? "").trim();
  if (intent === "") {
    return Response.json({ error: "intent_text is required" }, { status: 400, headers: cors });
  }

  // An outside caller may bring its own mandate; otherwise it gets a demo one,
  // which is what makes this usable from a chat tool without a signup flow.
  const presented = lookupMandate(body.mandate_hash ?? null);
  const mandateHash =
    presented !== null && typeof body.mandate_hash === "string"
      ? body.mandate_hash
      : mintAndRegisterDemoIntent().hash;

  // The SKU has to exist *and* the match has to be confident. This is the same
  // resolver the in-app agent uses: sharing one word with a real product is not
  // good enough to spend someone's money on.
  const query = normaliseIntent(intent);
  const hit = resolveSku(query);

  if (hit === null) {
    return Response.json(
      {
        status: "not_found",
        message: "I could not find that product, so I am not adding anything.",
        query,
        payment_link_id: null,
        short_url: null,
      },
      { status: 200, headers: cors },
    );
  }

  const lines = [{ sku_id: hit.id, qty: 1 }];
  const suggestions = recommend(lines);
  const top = suggestions[0];

  // No upsell worth asking about — go straight to a link.
  if (top === undefined) {
    const result = await toQuote(origin, lines, mandateHash, buyer);
    return Response.json(
      { ...result.body, upsell_accepted: false },
      { status: result.status, headers: cors },
    );
  }

  // There is one. Stop and ask: this is the last human contact.
  const resumeToken = await signResume({
    intent,
    lines,
    suggestions: suggestions.map((x) => ({
      sku_id: x.sku_id,
      title: x.title,
      price_paise: x.price_paise,
      extra_bps: x.extra_bps,
    })),
    mandate_hash: mandateHash,
  });

  const preview = priceCart(CATALOG, lines);
  const withUpsell = priceCart(CATALOG, [...lines, { sku_id: top.sku_id, qty: 1 }]);

  return Response.json(
    {
      status: "need_upsell_decision",
      resume_token: resumeToken,
      found: { sku_id: hit.id, title: hit.title, price_paise: hit.price_paise },
      suggestion: {
        sku_id: top.sku_id,
        title: top.title,
        price_paise: top.price_paise,
        extra_bps: top.extra_bps,
        message: `Adding ${top.title} unlocks an extra ${top.extra_bps / 100}% that policy allows.`,
      },
      // Up to three, ranked by how much legal discount each would unlock.
      suggestions: suggestions.map((s) => ({
        sku_id: s.sku_id,
        title: s.title,
        price_paise: s.price_paise,
        extra_bps: s.extra_bps,
        extra_paise: s.extra_paise,
      })),
      quote_preview: {
        without_upsell_subtotal_paise: preview.amount_paise,
        with_upsell_subtotal_paise: withUpsell.amount_paise,
        note: "Subtotals before discount. The kernel decides the final rung at quote time.",
      },
      payment_link_id: null,
      short_url: null,
    },
    { status: 200, headers: cors },
  );
}
