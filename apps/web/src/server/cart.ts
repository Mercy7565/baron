import type { CartLine } from "@countersign/catalog";

/**
 * A basket line, plus whether it is a gift.
 *
 * A gift line is in the bag and shipped, but never priced: a buy-one-get-one
 * campaign hands over a product without charging for it, and it must not become
 * a discount on the Razorpay side. The seven dashboard coupons are the only
 * thing that ever reduces a total; a gift is simply not part of one.
 */
export interface BasketLine extends CartLine {
  gift?: boolean;
  /**
   * Which campaign put this line in the bag.
   *
   * Set for a gift and for an accepted paid suggestion alike, because a
   * campaign's budget is spent by both: a free product costs its catalog price,
   * and a suggestion the shopper took is what the campaign was for. Without
   * this the burn had nothing to attribute against, so every campaign sat at
   * zero no matter how well it worked.
   */
  from_campaign_id?: string;
}

/**
 * Demo cart storage: an in-process Map keyed by cart id.
 *
 * Deliberately not a database. Carts live for the length of the dev server,
 * which is exactly as long as a demo. The DB slice replaces this file and
 * nothing else — every consumer goes through the four functions below.
 */
/**
 * Held on globalThis rather than in module scope: Next's dev server reloads
 * route modules between requests, which would otherwise empty the cart
 * mid-conversation.
 */
const globalForCarts = globalThis as typeof globalThis & {
  __countersign_carts?: Map<string, BasketLine[]>;
};

const CARTS: Map<string, BasketLine[]> =
  globalForCarts.__countersign_carts ?? new Map<string, BasketLine[]>();

globalForCarts.__countersign_carts = CARTS;

export const DEMO_CART_ID = "cart_demo_session";

export function getCart(cartId: string): BasketLine[] {
  return CARTS.get(cartId) ?? [];
}

export function setCart(cartId: string, lines: BasketLine[]): BasketLine[] {
  CARTS.set(cartId, lines);
  return lines;
}

export function addToCart(
  cartId: string,
  skuId: string,
  qty: number,
  origin?: { campaign_id: string; gift?: boolean },
): BasketLine[] {
  const gift = origin?.gift === true ? origin : undefined;
  const lines = [...getCart(cartId)];
  // A gift and a bought copy of the same product are different lines: one is
  // charged for and one is not, so merging them would quietly charge for the
  // gift or give away the paid one.
  const existing = lines.find((l) => l.sku_id === skuId && (l.gift === true) === (gift !== undefined));

  if (existing === undefined) {
    lines.push({
      sku_id: skuId,
      qty,
      ...(gift === undefined ? {} : { gift: true }),
      ...(origin === undefined ? {} : { from_campaign_id: origin.campaign_id }),
    });
  } else {
    existing.qty += qty;
  }

  // Quantities are only sanity-checked here; the real ceiling is enforced by
  // guardCart against catalog stock, on the money path.
  return setCart(cartId, lines.filter((l) => l.qty > 0));
}

export function removeFromCart(cartId: string, skuId: string): CartLine[] {
  return setCart(
    cartId,
    getCart(cartId).filter((l) => l.sku_id !== skuId),
  );
}

/**
 * Empty a basket.
 *
 * Called from the confirmed-payment path, so a shopper who has paid does not
 * come back to the bag they just bought. An unpaid bag is never cleared — it is
 * still theirs to finish or close.
 */
export function clearCart(cartId: string): BasketLine[] {
  return setCart(cartId, []);
}

/**
 * The lines that are actually charged for.
 *
 * Everything that prices, guards or quotes a basket goes through this, so a
 * gift can never reach the kernel as an amount. What the shopper sees as a
 * "₹0" line is simply absent from the money path.
 */
export function payableLines(cartId: string): CartLine[] {
  return getCart(cartId)
    .filter((l) => l.gift !== true)
    .map((l) => ({ sku_id: l.sku_id, qty: l.qty }));
}
