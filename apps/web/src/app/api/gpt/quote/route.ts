import { POST as createQuote } from "@/app/api/quotes/route";
import { json, noSuchShop, preflight, scopeFor, shopperFrom } from "@/server/gpt-shopper";
import { mintAndRegisterDemoIntent } from "@/server/mandates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = preflight;

interface QuoteBody {
  shop_code?: string;
  sku_lines?: Array<{ sku_id?: string; qty?: number }>;
  requested_discount_bps?: number;
  /** Whatever price the model said out loud. Recorded, then ignored. */
  spoken_total?: number | string;
}

/**
 * POST /api/gpt/quote
 *
 * create_quote — price a basket. The only place a total is ever decided.
 *
 * The whole point of this endpoint is what it does *not* do with
 * `spoken_total`. A model that has told the shopper "that'll be ₹500" has an
 * obvious incentive to make the bill say ₹500, and an agent that could assert
 * its own price would make every guarantee in this system decorative. So the
 * figure is accepted, echoed back so the discrepancy is visible, and plays no
 * part in the arithmetic: the catalog sets prices and the kernel sets the
 * discount, exactly as they do for a human in a browser.
 *
 * `requested_discount_bps` is an *ask*, not an instruction. The kernel may ALLOW
 * it, CLAMP it down to what the basket really qualifies for, or refuse — and a
 * CLAMP is the interesting case to show a judge, because it is the model being
 * overruled in public.
 *
 * The pricing itself is the existing `/api/quotes` handler, called in process.
 * Reimplementing it here would mean a second copy of the money path, and two
 * copies of the money path is one more than can ever be trusted.
 */
export async function POST(request: Request): Promise<Response> {
  let body: QuoteBody = {};
  try {
    body = (await request.json()) as QuoteBody;
  } catch {
    return json({ error: "bad_request", message: "Body must be JSON." }, 400);
  }

  const scope = scopeFor(body.shop_code ?? null);
  if (scope === null) return noSuchShop();

  const lines = (Array.isArray(body.sku_lines) ? body.sku_lines : [])
    .map((l) => ({ sku_id: String(l?.sku_id ?? "").trim(), qty: Math.max(1, Number(l?.qty ?? 1)) }))
    .filter((l) => l.sku_id !== "");

  if (lines.length === 0) {
    return json(
      {
        error: "no_lines",
        message: "Pass at least one sku_lines entry using a sku_id from search_catalog.",
      },
      400,
    );
  }

  // A GPT carries no mandate, so it gets a demo one — the same posture the
  // existing outside-agent endpoint takes. The mandate still bounds what the
  // quote may do; it simply was not negotiated in advance.
  const mandate = mintAndRegisterDemoIntent();

  const inner = new Request("https://baron.internal/api/quotes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      buyer_user_id: shopperFrom(request),
      agent_id: "custom_gpt",
      mandate_hash: mandate.hash,
      sku_lines: lines,
      ...(typeof body.requested_discount_bps === "number"
        ? { requested_discount_bps: body.requested_discount_bps }
        : {}),
    }),
  });

  const res = await createQuote(inner);
  const priced = (await res.json()) as Record<string, unknown>;

  // An unpriceable basket returns no quote_id. Say so in the model's own terms
  // rather than handing back a 200 that looks like success.
  if (typeof priced.quote_id !== "string") {
    return json(
      {
        quote_id: null,
        error: typeof priced.error === "string" ? priced.error : "not_quotable",
        message:
          typeof priced.reason === "string"
            ? priced.reason
            : "This basket could not be priced. Do not tell the shopper a price.",
        refused_skus: priced.refused_skus ?? [],
      },
      res.status === 200 ? 422 : res.status,
    );
  }

  const legal = Number(priced.legal_total_paise ?? 0);
  const spoken = body.spoken_total === undefined ? null : Number(body.spoken_total);

  return json({
    quote_id: priced.quote_id,
    shop_code: scope.code,
    verdict: priced.verdict,
    subtotal_paise: priced.subtotal_paise,
    legal_total_paise: legal,
    legal_total_inr: legal / 100,
    asked_bps: priced.asked_bps,
    applied_bps: priced.applied_bps,
    offer_id: priced.offer_id,
    campaign_name: priced.campaign_name ?? null,
    expires_at: priced.expires_at,
    reason: priced.reason,
    refused_skus: priced.refused_skus ?? [],

    /**
     * What the model said, next to what is true.
     *
     * Present only when the model volunteered a figure. `honoured: false` is
     * not an error — it is the design, stated where a judge can see it.
     */
    spoken_total:
      spoken === null || Number.isNaN(spoken)
        ? null
        : {
            you_said_paise: spoken,
            honoured: false,
            note: "Ignored. The catalog and the kernel set the price; a spoken figure never does.",
          },

    next_step:
      "Show the shopper legal_total_inr and wait. Call pay_quote only after they say yes.",
  });
}
