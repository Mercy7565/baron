import { cookies } from "next/headers";

import type { CartLine } from "@countersign/catalog";

import { signValue, verifyValue } from "@/server/sign";

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
 * The basket lives in the shopper's own cookie.
 *
 * It used to be an in-process Map on `globalThis`, keyed by one shared constant
 * for every visitor. Both halves of that were wrong in production. Each
 * serverless instance has its own `globalThis`, so two refreshes landing on two
 * lambdas showed two different baskets — or an empty one — at random. And a
 * single shared key meant every browser on the deployment was editing the same
 * bag, so a stranger's serum could appear in yours.
 *
 * A cookie fixes both: it is per browser by construction, and it travels with
 * the request, so any instance can serve it. It is signed, because an unsigned
 * basket is a place to type your own `sku_id` — and while the money path
 * re-prices everything from the catalog and would catch that, a forged bag
 * still has no business being accepted here.
 *
 * What the cookie holds is only *what* is in the bag. Prices are never stored:
 * every read re-prices from the catalog by `sku_id`, so a basket cannot carry a
 * stale price across a catalog edit.
 */
export const CART_COOKIE = "baron_cart";

/** Shape stored in the cookie. Keys are short because 4KB is the whole budget. */
interface StoredCart {
  v: 1;
  /** Which shop this bag belongs to, so switching shops does not mix baskets. */
  shop: string;
  lines: Array<{ s: string; q: number; g?: 1; c?: string }>;
}

/** A bag with more lines than this is not a bag, it is an attack. */
const MAX_LINES = 40;
const MAX_QTY = 99;

function toStored(shop: string, lines: BasketLine[]): StoredCart {
  return {
    v: 1,
    shop,
    lines: lines.slice(0, MAX_LINES).map((l) => ({
      s: l.sku_id,
      q: Math.max(1, Math.min(MAX_QTY, Math.trunc(l.qty))),
      ...(l.gift === true ? { g: 1 as const } : {}),
      ...(l.from_campaign_id === undefined ? {} : { c: l.from_campaign_id }),
    })),
  };
}

function fromStored(stored: StoredCart): BasketLine[] {
  return stored.lines.map((l) => ({
    sku_id: l.s,
    qty: l.q,
    ...(l.g === 1 ? { gift: true } : {}),
    ...(l.c === undefined ? {} : { from_campaign_id: l.c }),
  }));
}

// ------------------------------------------------------------- pure basket ops
//
// Kept separate from the cookie so they can be tested without a request, and so
// the rules about gifts live in one place rather than in every caller.

/**
 * Add to a basket.
 *
 * A gift and a bought copy of the same product are different lines: one is
 * charged for and one is not, so merging them would quietly charge for the gift
 * or give away the paid one.
 */
export function addLine(
  lines: BasketLine[],
  skuId: string,
  qty: number,
  origin?: { campaign_id: string; gift?: boolean },
): BasketLine[] {
  const gift = origin?.gift === true;
  const next = lines.map((l) => ({ ...l }));
  const existing = next.find((l) => l.sku_id === skuId && (l.gift === true) === gift);

  if (existing === undefined) {
    next.push({
      sku_id: skuId,
      qty,
      ...(gift ? { gift: true } : {}),
      ...(origin === undefined ? {} : { from_campaign_id: origin.campaign_id }),
    });
  } else {
    existing.qty += qty;
  }

  // Quantities are only sanity-checked here; the real ceiling is enforced by
  // guardCart against catalog stock, on the money path.
  return next
    .filter((l) => l.qty > 0)
    .map((l) => ({ ...l, qty: Math.min(MAX_QTY, l.qty) }))
    .slice(0, MAX_LINES);
}

export function removeLine(lines: BasketLine[], skuId: string): BasketLine[] {
  return lines.filter((l) => l.sku_id !== skuId);
}

/**
 * The lines that are actually charged for.
 *
 * Everything that prices, guards or quotes a basket goes through this, so a
 * gift can never reach the kernel as an amount. What the shopper sees as a
 * "₹0" line is simply absent from the money path.
 */
export function payable(lines: BasketLine[]): CartLine[] {
  return lines.filter((l) => l.gift !== true).map((l) => ({ sku_id: l.sku_id, qty: l.qty }));
}

// ----------------------------------------------------------------- the cookie

function isStored(value: unknown): value is StoredCart {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<StoredCart>;
  if (c.v !== 1 || typeof c.shop !== "string" || !Array.isArray(c.lines)) return false;
  return c.lines.every(
    (l) => typeof l === "object" && l !== null && typeof l.s === "string" && typeof l.q === "number",
  );
}

/**
 * The basket this request carries, for this shop.
 *
 * A bag stamped with a different shop code is not this shop's bag, so it reads
 * as empty rather than being shown under the wrong catalog. It is not deleted:
 * a shopper who goes back gets their basket back.
 */
export async function readBasket(shopCode: string | null): Promise<BasketLine[]> {
  // Outside a shop there is no basket to show. The cookie is left alone, so
  // walking back in returns the bag exactly as it was — leaving the shop is
  // not the same as emptying the bag.
  if (shopCode === null) return [];

  const jar = await cookies();
  const raw = jar.get(CART_COOKIE)?.value;
  if (raw === undefined || raw === "") return [];

  const payload = await verifyValue(raw);
  if (payload === null) return [];

  try {
    const parsed: unknown = JSON.parse(payload);
    if (!isStored(parsed)) return [];
    if (parsed.shop !== shopCode) return [];
    return fromStored(parsed);
  } catch {
    return [];
  }
}

/** Write the basket back. Called only from route handlers, which may set cookies. */
export async function writeBasket(shopCode: string, lines: BasketLine[]): Promise<BasketLine[]> {
  const jar = await cookies();
  const value = await signValue(JSON.stringify(toStored(shopCode, lines)));

  jar.set(CART_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return lines;
}

/**
 * Empty a basket.
 *
 * Called from the confirmed-payment path, so a shopper who has paid does not
 * come back to the bag they just bought. An unpaid bag is never cleared — it is
 * still theirs to finish or close.
 */
export async function clearBasket(): Promise<void> {
  const jar = await cookies();
  jar.delete(CART_COOKIE);
}
