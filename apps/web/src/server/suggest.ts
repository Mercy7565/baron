import { priceCart, productById, type Product } from "@countersign/catalog";
import { allOrders } from "@countersign/orders";

import { CAMPAIGNS, isCampaignActive } from "@/lib/campaigns";
import { createdCampaigns, type CreatedCampaign } from "@/server/overlay";
import { campaignSpentPaise } from "@/lib/campaigns";
import { CATALOG } from "@/lib/catalog";
import { DEV_POLICY } from "@/lib/policy";

import { bestClearableBps, couponFor } from "@/server/coupons";

/**
 * What the assistant offers to add, and why.
 *
 * Two suggestions at most, never the same SKU twice, and both grounded in
 * something real:
 *
 *   A. Bought together — the catalog's curated pairs, ranked by how often the
 *      two actually appeared on a *paid* order. Counting unpaid baskets would
 *      let a shopper who abandoned ten carts teach the store a habit nobody
 *      ever paid for.
 *
 *   B. Save more / clear stock — a product that either unlocks a bigger coupon
 *      on this basket, or is sitting on unusual stock, and which still leaves
 *      the resulting basket above the merchant's margin floor.
 *
 * Neither can name a blocked, out-of-stock or off-sale SKU, and neither invents
 * an offer id: any percentage quoted here is one `bestClearableBps` already
 * says the kernel would grant.
 */

export type SuggestionKind = "bought_together" | "save_more" | "clear_stock" | "gift";

export interface CartSuggestion {
  sku_id: string;
  title: string;
  price_paise: number;
  image: string;
  kind: SuggestionKind;
  /** The sentence shown to the shopper. */
  copy: string;
  /** The coupon the kernel would allow after this add, in bps. */
  coupon_bps_after: number;
  /** How much better that is than the basket as it stands. */
  extra_bps: number;
  campaign_id: string | null;
  campaign_name: string | null;
  /** True when accepting this adds the product at no charge. */
  gift?: boolean;
}

/** Sellable means sellable: never blocked, never out of stock, never off sale. */
function sellable(p: Product | null): p is Product {
  return (
    p !== null &&
    !p.blocked &&
    p.availability === "in_stock" &&
    p.stock_qty > 0 &&
    !DEV_POLICY.blocked_product_ids.includes(p.id)
  );
}

/**
 * How often each pair of SKUs appeared on an order Razorpay confirmed.
 *
 * Paid only. An issued link is not evidence of anything.
 */
function paidPairCounts(): Map<string, number> {
  const counts = new Map<string, number>();

  for (const order of allOrders()) {
    if (order.status !== "paid") continue;
    const ids = [...new Set(order.lines.map((l) => l.sku_id))].sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]}|${ids[j]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function pairCount(counts: Map<string, number>, a: string, b: string): number {
  const [x, y] = a < b ? [a, b] : [b, a];
  return counts.get(`${x}|${y}`) ?? 0;
}

/** Stock well above the median is stock that is not moving. */
function slowMovers(): Set<string> {
  const stocks = CATALOG.products
    .filter((p) => sellable(p))
    .map((p) => p.stock_qty)
    .sort((a, b) => a - b);
  if (stocks.length === 0) return new Set();

  const median = stocks[Math.floor(stocks.length / 2)] ?? 0;
  return new Set(
    CATALOG.products.filter((p) => sellable(p) && p.stock_qty > median * 1.5).map((p) => p.id),
  );
}

/** A campaign that is live now and names this SKU. */
function campaignFor(skuId: string, now: Date): { id: string; name: string } | null {
  for (const c of CAMPAIGNS) {
    if (!isCampaignActive(c.id)) continue;
    if (c.spent_paise >= c.spend_ceiling_paise) continue;
    if (Date.parse(c.window_start) > now.getTime()) continue;
    if (Date.parse(c.window_end) < now.getTime()) continue;

    const t = c.target;
    const hit =
      t.kind === "sku"
        ? t.sku_ids.includes(skuId)
        : t.kind === "category"
          ? (productById(CATALOG, skuId)?.category.includes(t.category) ?? false)
          : false;

    if (hit) return { id: c.id, name: c.name };
  }
  return null;
}

/**
 * A campaign the merchant built, live right now, whose trigger is in this bag.
 *
 * Merchant campaigns are checked before anything the catalog or the stock
 * levels suggest. A merchant who set up "lip balm gets a free starter kit" and
 * then watched the assistant recommend a cleanser instead would be right to
 * conclude the console was decorative.
 */
function merchantMatch(
  lines: Array<{ sku_id: string; qty: number }>,
  now: Date,
): { campaign: CreatedCampaign; reward: Product } | null {
  const inCart = new Set(lines.map((l) => l.sku_id));

  for (const c of createdCampaigns()) {
    // Cancelled is final; paused is temporary. Neither may suggest.
    if (c.cancelled === true || !c.active) continue;
    if (Date.parse(c.starts_at) > now.getTime()) continue;
    if (Date.parse(c.ends_at) < now.getTime()) continue;
    if (!c.trigger_sku_ids.some((id) => inCart.has(id))) continue;
    if (c.reward_sku_id === null || inCart.has(c.reward_sku_id)) continue;

    // A reward the merchant has taken off the shop cannot be offered. The
    // campaign row says "SKU removed" so this is visible rather than silent.
    const reward = productById(CATALOG, c.reward_sku_id);
    if (!sellable(reward)) continue;

    // A campaign that cannot afford what it is about to suggest stops
    // suggesting. Giving away a product the budget cannot cover is how a
    // campaign quietly overspends.
    const cost = c.kind === "bogo" ? reward.price_paise : reward.price_paise;
    if (campaignSpentPaise(c.id) + cost > c.budget_paise) continue;

    return { campaign: c, reward };
  }
  return null;
}

export function suggestForCart(
  lines: Array<{ sku_id: string; qty: number }>,
  now = new Date(),
): CartSuggestion[] {
  if (lines.length === 0) return [];

  const inCart = new Set(lines.map((l) => l.sku_id));
  const before = couponFor(lines, now);
  const counts = paidPairCounts();
  const slow = slowMovers();

  /** Candidates: curated edges from what is already in the basket. */
  const edges: Product[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const p = productById(CATALOG, line.sku_id);
    if (p === null) continue;
    for (const id of [...p.upgrades, ...p.complements, ...(p.frequently_bought_with ?? [])]) {
      if (inCart.has(id) || seen.has(id)) continue;
      const rec = productById(CATALOG, id);
      if (!sellable(rec)) continue;
      seen.add(id);
      edges.push(rec);
    }
  }

  /** Anything sellable, for the stock-clearing slot. */
  const anySellable = CATALOG.products.filter((p) => sellable(p) && !inCart.has(p.id));

  const score = (p: Product) => {
    const projected = [...lines, { sku_id: p.id, qty: 1 }];
    const priced = priceCart(CATALOG, projected);
    const couponAfter = bestClearableBps(priced.amount_paise, priced.margin_bps);

    // The floor is checked on the basket that would result, after the coupon
    // that would apply — not on the product in isolation.
    const marginAfterCoupon = priced.margin_bps - couponAfter;
    const withinFloor = marginAfterCoupon >= DEV_POLICY.margin_floor_bps;
    const affordable = priced.amount_paise <= DEV_POLICY.max_order_paise;

    return { priced, couponAfter, withinFloor, affordable };
  };

  const out: CartSuggestion[] = [];
  const used = new Set<string>();

  // ---- 0. What the merchant actually asked for ----------------------------
  //
  // First, and unconditionally: a live campaign whose trigger is in this bag
  // outranks anything the catalog edges or the stock levels would suggest.
  const mine = merchantMatch(lines, now);
  if (mine !== null) {
    const isGift = mine.campaign.kind === "bogo";
    const s = score(mine.reward);

    out.push({
      sku_id: mine.reward.id,
      title: mine.reward.title,
      price_paise: isGift ? 0 : mine.reward.price_paise,
      image: mine.reward.image,
      kind: isGift ? "gift" : "save_more",
      copy: isGift
        ? `Add ${mine.reward.title} free.`
        : `Add ${mine.reward.title} — ${mine.campaign.name}.`,
      // A gift changes nothing about the coupon: it is not part of the amount.
      coupon_bps_after: isGift ? before.applied_bps : s.couponAfter,
      extra_bps: isGift ? 0 : Math.max(0, s.couponAfter - before.applied_bps),
      campaign_id: mine.campaign.id,
      campaign_name: mine.campaign.name,
      gift: isGift,
    });
    used.add(mine.reward.id);
  }

  // ---- A. Bought together -------------------------------------------------
  //
  // Ranked by paid co-purchases first, then by catalog order so an empty
  // ledger still produces a sensible, stable answer.
  // Excluding what the merchant slot already took: two rows naming the same
  // product is not two suggestions, it is one suggestion and a bug.
  const together = out.length >= 2 ? undefined : edges.filter((p) => !used.has(p.id))
    .map((p) => ({
      p,
      paid: lines.reduce((n, l) => n + pairCount(counts, l.sku_id, p.id), 0),
    }))
    .filter(({ p }) => {
      const s = score(p);
      return s.withinFloor && s.affordable;
    })
    .sort((a, b) => (b.paid !== a.paid ? b.paid - a.paid : a.p.id < b.p.id ? -1 : 1))[0];

  if (together !== undefined) {
    const s = score(together.p);
    const anchor = productById(CATALOG, lines[0]?.sku_id ?? "");
    const campaign = campaignFor(together.p.id, now);
    out.push({
      sku_id: together.p.id,
      title: together.p.title,
      price_paise: together.p.price_paise,
      image: together.p.image,
      kind: "bought_together",
      copy: `People usually buy ${together.p.title} with ${anchor?.title ?? "this"}.`,
      coupon_bps_after: s.couponAfter,
      extra_bps: Math.max(0, s.couponAfter - before.applied_bps),
      campaign_id: campaign?.id ?? null,
      campaign_name: campaign?.name ?? null,
    });
    used.add(together.p.id);
  }

  // ---- B. Save more, or clear slow stock -----------------------------------
  const candidates =
    out.length >= 2 ? [] : [...edges, ...anySellable].filter((p) => !used.has(p.id));

  let best: { p: Product; couponAfter: number; slow: boolean } | null = null;

  for (const p of candidates) {
    const s = score(p);
    if (!s.withinFloor || !s.affordable) continue;

    const unlocks = s.couponAfter > before.applied_bps;
    const isSlow = slow.has(p.id);
    if (!unlocks && !isSlow) continue;

    // A suggestion that unlocks a bigger coupon always beats one that merely
    // clears stock; between two that unlock, the larger coupon wins; between
    // two of a kind, the lower id, so the same basket ranks the same way twice.
    const candidate = { p, couponAfter: s.couponAfter, slow: !unlocks };
    if (best === null) {
      best = candidate;
      continue;
    }
    if (best.slow && !candidate.slow) best = candidate;
    else if (best.slow === candidate.slow && candidate.couponAfter > best.couponAfter) best = candidate;
    else if (
      best.slow === candidate.slow &&
      candidate.couponAfter === best.couponAfter &&
      candidate.p.id < best.p.id
    ) {
      best = candidate;
    }
  }

  if (best !== null) {
    const campaign = campaignFor(best.p.id, now);
    out.push({
      sku_id: best.p.id,
      title: best.p.title,
      price_paise: best.p.price_paise,
      image: best.p.image,
      kind: best.slow ? "clear_stock" : "save_more",
      copy: best.slow
        ? `Add ${best.p.title} — this is moving slowly and still stays above your margin floor.`
        : `Add ${best.p.title} — a bigger coupon becomes available.`,
      coupon_bps_after: best.couponAfter,
      extra_bps: Math.max(0, best.couponAfter - before.applied_bps),
      campaign_id: campaign?.id ?? null,
      campaign_name: campaign?.name ?? null,
    });
  }

  return out.slice(0, 2);
}
