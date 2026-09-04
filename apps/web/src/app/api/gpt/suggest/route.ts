import { productById } from "@countersign/catalog";

import { CATALOG } from "@/lib/catalog";
import { json, noSuchShop, preflight, scopeFor } from "@/server/gpt-shopper";
import { suggestForCart } from "@/server/suggest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = preflight;

/**
 * GET /api/gpt/suggest?shop_code=…&sku_ids=a,b
 *
 * suggest_add_on — one real thing the shopper might also want.
 *
 * Every candidate comes from `suggestForCart`, the same recommender the shop's
 * own assistant uses, so a GPT cannot reach a product the website would not
 * have offered. That matters more here than anywhere else: a model asked to
 * "suggest something" will happily produce a plausible-sounding product that
 * does not exist, and this is the call where that would turn into a purchase.
 *
 * Two things are deliberately absent. There is no coupon in the response — a
 * suggestion never stacks a second discount, and the only discount that exists
 * is the one the kernel grants at quote time on the whole basket. And nothing
 * is added to anything: the GPT is told to ask first and then re-quote, because
 * an add-on the shopper did not agree to is an item they did not buy.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const scope = scopeFor(url.searchParams.get("shop_code"));
  if (scope === null) return noSuchShop();

  const skuIds = (url.searchParams.get("sku_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  if (skuIds.length === 0) {
    return json(
      {
        error: "bad_request",
        message: "Pass sku_ids as a comma-separated list of what is already in the basket.",
      },
      400,
    );
  }

  // An id that is not in this catalog is dropped rather than guessed at.
  const known = skuIds.filter((id) => productById(CATALOG, id) !== null);
  if (known.length === 0) {
    return json({
      shop_code: scope.code,
      suggestions: [],
      note: "None of those sku_ids are in this shop. Search again before suggesting anything.",
    });
  }

  const lines = known.map((id) => ({ sku_id: id, qty: 1 }));
  const suggestions = suggestForCart(lines);

  /**
   * Only what is really on the shelf.
   *
   * `suggestForCart` already filters to sellable stock, but the check is
   * repeated because this is the surface where a stale suggestion becomes a
   * model telling a shopper about something the shop cannot send.
   */
  const rows = suggestions
    .map((s) => {
      const p = productById(CATALOG, s.sku_id);
      if (p === null) return null;
      if (p.blocked || p.availability !== "in_stock" || p.stock_qty <= 0) return null;

      const why =
        s.kind === "bought_together"
          ? "Often bought together with what is already in the basket."
          : s.kind === "gift"
            ? `Free with this basket under ${s.campaign_name ?? "a live campaign"}.`
            : s.campaign_name !== null
              ? `Part of ${s.campaign_name}, a campaign running in this shop now.`
              : "Adding this reaches a larger coupon the store already offers.";

      return {
        sku_id: p.id,
        title: p.title,
        price_paise: s.gift === true ? 0 : p.price_paise,
        price_inr: s.gift === true ? 0 : p.price_paise / 100,
        free: s.gift === true,
        in_stock: true,
        why,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    // One at a time. Two suggestions is a sales pitch, not a suggestion.
    .slice(0, 1);

  return json({
    shop_code: scope.code,
    suggestions: rows,
    note:
      rows.length === 0
        ? "Nothing worth adding to this basket. Do not invent one."
        : "Ask the shopper before adding it. If they agree, call create_quote with the new sku_lines.",
  });
}
