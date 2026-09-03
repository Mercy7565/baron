import { productById } from "@countersign/catalog";

import { CATALOG } from "@/lib/catalog";
import { DEMO_CART_ID } from "@/server/cart";
import { add_to_cart, get_cart, remove_from_cart, suggest_upsell } from "@/server/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  const { lines, cart } = get_cart(DEMO_CART_ID);
  return Response.json({
    cart_id: DEMO_CART_ID,
    // Raw bag, gifts included and flagged, each with its title so the basket
    // can show a free line without a second lookup.
    lines: lines.map((l) => ({
      ...l,
      title: productById(CATALOG, l.sku_id)?.title ?? l.sku_id,
    })),
    cart,
    upsell: suggest_upsell(DEMO_CART_ID),
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: {
    action?: string;
    sku_id?: string;
    qty?: number;
    /** Set when a campaign is giving this line away: it is never charged for. */
    gift_campaign_id?: string;
    /** Set when a campaign's suggestion was accepted at the normal price. */
    from_campaign_id?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const skuId = body.sku_id ?? "";
  if (skuId === "") return Response.json({ error: "sku_id required" }, { status: 400 });

  // qty may be negative: the basket's "−" button is an add of -1, and
  // addToCart already drops a line whose quantity reaches zero.
  const result =
    body.action === "remove"
      ? remove_from_cart(DEMO_CART_ID, skuId)
      : add_to_cart(
          DEMO_CART_ID,
          skuId,
          Number.isFinite(body.qty) ? Number(body.qty) : 1,
          // A gift is shipped but never charged for. It reaches the basket
          // flagged, and the money path filters it out entirely.
          typeof body.gift_campaign_id === "string" && body.gift_campaign_id !== ""
            ? { campaign_id: body.gift_campaign_id, gift: true }
            : typeof body.from_campaign_id === "string" && body.from_campaign_id !== ""
              ? { campaign_id: body.from_campaign_id }
              : undefined,
        );

  return Response.json({
    cart_id: DEMO_CART_ID,
    ...result,
    lines: result.lines.map((l) => ({
      ...l,
      title: productById(CATALOG, l.sku_id)?.title ?? l.sku_id,
    })),
    upsell: suggest_upsell(DEMO_CART_ID),
  });
}
