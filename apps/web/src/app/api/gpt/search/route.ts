import type { Product } from "@countersign/catalog";

import { json, noSuchShop, preflight, scopeFor } from "@/server/gpt-shopper";
import { resolveSku, search_catalog } from "@/server/tools";
import { hydrateOverlay } from "@/server/overlay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = preflight;

/** Only fields a shopper may see. Margin and cost never leave the server. */
function publicProduct(p: Product) {
  return {
    sku_id: p.id,
    title: p.title,
    price_paise: p.price_paise,
    price_inr: p.price_paise / 100,
    in_stock: p.availability === "in_stock" && p.stock_qty > 0 && !p.blocked,
  };
}

/**
 * GET /api/gpt/search?q=…&shop_code=…
 *
 * search_catalog — what this shop actually sells that matches those words.
 *
 * `confident_match` is the important field. Ranked results always return
 * *something*, which is how "unicorn cream" once became "Peptide Eye Cream" on
 * the way to spending money. The resolver applies a confidence bar, and when
 * nothing clears it this says so — a GPT should treat an empty
 * `confident_match` as "we do not sell that", not as an invitation to pick the
 * closest row.
 */
export async function GET(request: Request): Promise<Response> {
  // Merchant state is durable and shared; pull it into this instance
  // before anything reads a campaign, a catalog edit or the margin floor.
  await hydrateOverlay();

  const url = new URL(request.url);
  const scope = scopeFor(url.searchParams.get("shop_code"));
  if (scope === null) return noSuchShop();

  const q = (url.searchParams.get("q") ?? "").trim();
  if (q === "") {
    return json({ error: "bad_request", message: "Pass `q`, the words the shopper used." }, 400);
  }

  const ranked = search_catalog(q, 5).map(publicProduct);
  const confident = resolveSku(q);

  return json({
    shop_code: scope.code,
    query: q,
    // The one the store is willing to stand behind. Null means "not sold here".
    confident_match: confident === null ? null : publicProduct(confident),
    results: ranked,
    note:
      confident === null
        ? "Nothing matched confidently. Tell the shopper this shop does not sell that, and do not substitute a similar product."
        : "Quote `confident_match.sku_id`. Do not quote a result the shopper did not ask for.",
  });
}
