import {
  affordableHintBps,
  type Campaign,
  inWindow,
  pick,
} from "@countersign/campaigns";
import { priceCart } from "@countersign/catalog";
import { couponDiscountPaise, evaluate } from "@countersign/kernel";

import { CAMPAIGNS, isCampaignActive } from "@/lib/campaigns";
import { CATALOG } from "@/lib/catalog";
import { DEV_POLICY } from "@/lib/policy";

/**
 * What coupon would actually apply to a basket.
 *
 * The agent used to answer this with an approximation — margin headroom capped
 * by the campaign hint, rounded to a rung — which could name a percentage the
 * kernel would then refuse. A shopper told "you'll get 15%" and charged a 5%
 * discount has been lied to, however good the intention.
 *
 * So this runs the real `evaluate()` against the real policy, with the same ask
 * the quote flow uses. Whatever it returns is what the quote will return, on
 * the same inputs, because it is the same function.
 */

/**
 * The best coupon this basket can actually clear.
 *
 * The shop used to ask for a flat 15% on every basket. That made almost every
 * decision a CLAMP and made "wanted" a meaningless column — of course it was
 * 15%, it was always 15%. It was also dishonest in shape: nobody had asked for
 * 15%, so recording that a customer wanted it and was refused described an
 * argument that never happened.
 *
 * So the house asks for what the basket can have: the highest rung whose
 * minimum cart this basket meets and whose discount the margin floor can still
 * fund. A quote then reads ALLOW, because the ask and the answer agree, and a
 * CLAMP means someone genuinely asked for more than policy allows.
 */
export function bestClearableBps(amountPaise: number, marginBps: number): number {
  let best = 0;
  for (const rung of DEV_POLICY.ladder) {
    if (amountPaise < rung.min_cart_paise) continue;
    if (marginBps - rung.discount_bps < DEV_POLICY.margin_floor_bps) continue;
    if (rung.discount_bps > best) best = rung.discount_bps;
  }
  return best;
}

export interface CouponOutcome {
  subtotal_paise: number;
  /** The coupon the kernel actually chose. Null when none survived. */
  offer_id: string | null;
  applied_bps: number;
  /** Rupees off, after the coupon's own cap. */
  discount_paise: number;
  total_paise: number;
  verdict: string;
  /** True when the coupon's rupee cap bit before its percentage did. */
  capped: boolean;
  /** The campaign that may whisper about this basket, if any. */
  campaign: Campaign | null;
  /** What that campaign can still afford on this basket, in bps. */
  campaign_affordable_bps: number;
}

function liveCampaigns(): Campaign[] {
  return CAMPAIGNS.map((c) => ({ ...c, active: isCampaignActive(c.id) }));
}

/**
 * Run the kernel over a basket and report the coupon in plain numbers.
 *
 * A paused campaign is excluded by `isCampaignActive`, and one outside its
 * window by `inWindow`, so pausing a campaign genuinely stops it whispering
 * here rather than only hiding it in the console.
 */
export function couponFor(
  lines: Array<{ sku_id: string; qty: number }>,
  now = new Date(),
  askBps: number | null = null,
): CouponOutcome {
  const cart = priceCart(CATALOG, lines);
  const campaigns = liveCampaigns();
  const chosen = pick(campaigns, CATALOG, cart, now);

  const campaign =
    chosen.campaign !== null && inWindow(chosen.campaign, now) ? chosen.campaign : null;
  const affordable = campaign === null ? 0 : affordableHintBps(campaign, cart.amount_paise);

  // Ask for what this basket can clear, unless a caller named a figure itself.
  // A campaign no longer moves this number: it can suggest a product, but it
  // cannot raise the charged percentage past what the cart size and the margin
  // floor allow, which is what a campaign should always have been.
  const clearable = bestClearableBps(cart.amount_paise, cart.margin_bps);
  const ask = askBps ?? clearable;

  const decision = evaluate(
    {
      cart_id: "coupon_probe",
      amount_paise: cart.amount_paise,
      currency: "INR",
      requested_discount_bps: ask,
      requested_offer_id: null,
      product_ids: cart.product_ids,
      margin_bps: cart.margin_bps,
    },
    DEV_POLICY,
  );

  const offerId = decision.offer_ids[0] ?? null;
  const rung = offerId === null ? null : (DEV_POLICY.ladder.find((r) => r.offer_id === offerId) ?? null);

  const raw = Math.floor((cart.amount_paise * decision.applied_discount_bps) / 10_000);
  const discount = rung === null ? 0 : couponDiscountPaise(rung, cart.amount_paise);

  return {
    subtotal_paise: cart.amount_paise,
    offer_id: offerId,
    applied_bps: decision.applied_discount_bps,
    discount_paise: discount,
    total_paise: cart.amount_paise - discount,
    verdict: decision.verdict,
    capped: rung !== null && raw > rung.max_discount_paise,
    campaign,
    campaign_affordable_bps: affordable,
  };
}

/** The same question, asked about the basket plus one more item. */
export function couponIfAdded(
  lines: Array<{ sku_id: string; qty: number }>,
  skuId: string,
  now = new Date(),
  askBps: number | null = null,
): CouponOutcome {
  return couponFor([...lines, { sku_id: skuId, qty: 1 }], now, askBps);
}
