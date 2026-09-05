import { productById } from "@countersign/catalog";

import { CATALOG } from "@/lib/catalog";
import { payable, readBasket, writeBasket, type BasketLine } from "@/server/cart";
import { couponFor } from "@/server/coupons";
import { enteredCode } from "@/server/shop-code";
import { add_to_cart, get_cart, remove_from_cart, suggest_upsell } from "@/server/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The basket, priced from the catalog on every request.
 *
 * Nothing about a price is stored anywhere. The cookie holds sku ids and
 * quantities; the amounts come from the catalog every time, so a basket cannot
 * carry a stale price across a catalog edit and cannot be edited into a
 * cheaper one.
 */
function view(lines: BasketLine[], shopCode: string | null) {
  const { cart } = get_cart(lines);

  /**
   * Lines the catalog no longer sells.
   *
   * Dropped from the priced bag but named, because silently blanking the whole
   * basket over one retired sku is how "could not price the cart" happened.
   * The shopper sees the rest of their bag and one sentence about the line that
   * went.
   */
  const dropped = lines
    .filter((l) => {
      const p = productById(CATALOG, l.sku_id);
      return p === null || p.blocked || p.availability !== "in_stock";
    })
    .map((l) => {
      const p = productById(CATALOG, l.sku_id);
      return {
        sku_id: l.sku_id,
        title: p?.title ?? l.sku_id,
        reason:
          p === null
            ? "This shop no longer lists that product."
            : p.blocked
              ? "This product has been taken off sale."
              : "This product is out of stock.",
      };
    });

  /**
   * The price, worked out here rather than by the browser.
   *
   * The basket page used to mint a mandate in one request and then ask
   * /api/quotes for a price in another. Two requests, two serverless instances,
   * and a mandate registry that lives in memory — so the second instance had
   * never heard of the mandate, answered 402, and the page said "we could not
   * price that bag" about a perfectly ordinary basket. A laptop reusing one
   * warm instance usually got away with it; a phone opening fresh connections
   * did not.
   *
   * `couponFor` runs the same `evaluate()` the quote path runs, against the
   * same policy, in this process. No mandate is involved because nothing is
   * being authorised — this is a price on a screen, not a payment.
   */
  const charged = payable(lines);
  const coupon = charged.length === 0 ? null : couponFor(charged);

  return {
    shop_code: shopCode,
    quote:
      coupon === null
        ? null
        : {
            subtotal_paise: coupon.subtotal_paise,
            applied_bps: coupon.applied_bps,
            offer_id: coupon.offer_id,
            discount_paise: coupon.discount_paise,
            legal_total_paise: coupon.total_paise,
            verdict: coupon.verdict,
            campaign_name: coupon.campaign?.name ?? null,
          },
    // Raw bag, gifts included and flagged, each with its title so the basket
    // can show a free line without a second lookup.
    lines: lines.map((l) => ({
      ...l,
      title: productById(CATALOG, l.sku_id)?.title ?? l.sku_id,
    })),
    cart,
    dropped,
    upsell: suggest_upsell(lines),
  };
}

export async function GET(): Promise<Response> {
  const shopCode = await enteredCode();
  const lines = await readBasket(shopCode);
  return Response.json(view(lines, shopCode));
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

  const shopCode = await enteredCode();
  if (shopCode === null) {
    // No shop, no basket. Writing one would stamp it with a shop the shopper
    // has not named, and it would read as empty on their next request anyway.
    return Response.json(
      { error: "no_shop_code", message: "Enter a shop code before adding to a basket." },
      { status: 403 },
    );
  }

  const skuId = body.sku_id ?? "";
  if (skuId === "") return Response.json({ error: "sku_id required" }, { status: 400 });

  const current = await readBasket(shopCode);

  // qty may be negative: the basket's "−" button is an add of -1, and
  // addLine already drops a line whose quantity reaches zero.
  const result =
    body.action === "remove"
      ? remove_from_cart(current, skuId)
      : add_to_cart(
          current,
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

  await writeBasket(shopCode, result.lines);

  return Response.json(view(result.lines, shopCode));
}

/** DELETE — empty the bag. The one way a basket legitimately goes to zero. */
export async function DELETE(): Promise<Response> {
  const shopCode = await enteredCode();
  if (shopCode !== null) await writeBasket(shopCode, []);
  return Response.json(view([], shopCode));
}
