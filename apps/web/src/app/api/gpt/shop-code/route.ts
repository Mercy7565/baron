import { CATALOG } from "@/lib/catalog";
import { json, noSuchShop, preflight, scopeFor } from "@/server/gpt-shopper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = preflight;

/**
 * POST /api/gpt/shop-code  { code }
 *
 * resolve_shop_code — the first call a GPT makes, every time.
 *
 * Baron is a platform, so there is no such thing as "the catalog": there is one
 * shop per code, and a model that has not named a shop has no shelf to read.
 * Answering the code first is what makes every later call scopeable, and it is
 * why a wrong code is a flat 404 rather than a fallback to some default store.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { code?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "bad_request", message: "Body must be JSON with a `code` field." }, 400);
  }

  const scope = scopeFor(body.code ?? null);
  if (scope === null) return noSuchShop();

  const sellable = CATALOG.products.filter(
    (p) => !p.blocked && p.availability === "in_stock" && p.stock_qty > 0,
  );

  return json({
    ok: true,
    shop_code: scope.code,
    shop_name: "Baron Skincare",
    currency: "INR",
    products_available: sellable.length,
    // Said plainly so the model does not have to infer it from a 402 later.
    next_step:
      "Use this shop_code on every other call. Search for what the shopper asked for; never invent a product or a price.",
  });
}
