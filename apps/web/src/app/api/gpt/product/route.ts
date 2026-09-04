import { productById } from "@countersign/catalog";

import { CATALOG } from "@/lib/catalog";
import { json, noSuchShop, preflight, scopeFor } from "@/server/gpt-shopper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = preflight;

/**
 * GET /api/gpt/product?sku_id=…&shop_code=…
 *
 * get_product — one product, by the id search returned.
 *
 * Deliberately narrow: an id that is not in this catalog is a 404, never a
 * best guess. The response carries no margin, no cost and no supplier — a
 * shopper-facing model gets shopper-facing facts.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const scope = scopeFor(url.searchParams.get("shop_code"));
  if (scope === null) return noSuchShop();

  const skuId = (url.searchParams.get("sku_id") ?? "").trim();
  if (skuId === "") {
    return json({ error: "bad_request", message: "Pass `sku_id` from a search result." }, 400);
  }

  const p = productById(CATALOG, skuId);
  if (p === null) {
    return json(
      {
        error: "no_such_product",
        message: `This shop does not sell ${skuId}. Search again; do not substitute another product.`,
      },
      404,
    );
  }

  const sellable = p.availability === "in_stock" && p.stock_qty > 0 && !p.blocked;

  return json({
    shop_code: scope.code,
    sku_id: p.id,
    title: p.title,
    price_paise: p.price_paise,
    price_inr: p.price_paise / 100,
    size: p.attributes.size ?? null,
    category: p.category ?? [],
    in_stock: sellable,
    // Said explicitly, because "in_stock: false" has been read as "try anyway".
    quotable: sellable
      ? "Yes. Include this sku_id in create_quote."
      : "No. This product cannot be bought right now; do not quote it.",
  });
}
