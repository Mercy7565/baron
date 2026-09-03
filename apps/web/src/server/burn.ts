import type { Order } from "@countersign/orders";

import { burnOnce } from "@/server/overlay";

/**
 * Charge the campaigns that caused a confirmed payment.
 *
 * A campaign's cost is the value of what it gave away or caused to be bought:
 *
 *   - a gift, at its catalog price, because the store handed it over;
 *   - a paid line the shopper accepted from that campaign's suggestion, at its
 *     line total, because that sale is what the campaign was for.
 *
 * The Razorpay coupon is deliberately NOT charged here. A coupon is a discount
 * the kernel chose from the seven dashboard offers; a campaign is a decision to
 * push a product. Rolling the two together made a campaign's "spent" a number
 * nobody could reconcile against anything.
 *
 * Idempotent on (payment_id, campaign_id): the refresh endpoint is polled, and
 * a campaign must be charged once per payment rather than once per poll.
 */
export interface BurnCharge {
  campaign_id: string;
  paise: number;
  why: "gift" | "suggested_line";
  applied: boolean;
}

export function burnForPaidOrder(order: Order): BurnCharge[] {
  const paymentId = order.razorpay_payment_id;
  if (paymentId === null || paymentId === "") return [];

  // One total per campaign before writing, so a campaign that both gifted and
  // sold on the same order is charged once and idempotency still holds.
  const owed = new Map<string, { paise: number; why: BurnCharge["why"] }>();

  for (const g of order.gift_lines ?? []) {
    if (g.from_campaign_id === null) continue;
    const prev = owed.get(g.from_campaign_id);
    owed.set(g.from_campaign_id, {
      paise: (prev?.paise ?? 0) + g.unit_price_paise * g.qty,
      why: "gift",
    });
  }

  const origins = order.line_origins ?? {};
  for (const line of order.lines) {
    const campaign = origins[line.sku_id];
    if (campaign === undefined) continue;
    const prev = owed.get(campaign);
    owed.set(campaign, {
      paise: (prev?.paise ?? 0) + line.line_total_paise,
      why: prev?.why ?? "suggested_line",
    });
  }

  const charges: BurnCharge[] = [];
  for (const [campaign_id, { paise, why }] of owed) {
    charges.push({ campaign_id, paise, why, applied: burnOnce(paymentId, campaign_id, paise) });
  }
  return charges;
}

/**
 * Recompute every campaign's spend from the paid orders on disk.
 *
 * The burn wrote one store while the console read another, so some campaigns
 * carry a figure that was never reconciled against anything and others carry
 * zero despite real gifts. Adding to those numbers would compound the error, so
 * this *sets* each campaign's spend to what the paid orders actually justify,
 * and rebuilds the burned ledger to match.
 *
 * Paid orders are the source of truth: every charge here is a gift the store
 * handed over or a suggestion a shopper took, on a payment Razorpay confirmed.
 */
export function reconcileCampaignSpend(orders: Order[]): {
  totals: Record<string, number>;
  burned: string[];
} {
  const totals: Record<string, number> = {};
  const burned: string[] = [];

  for (const order of orders) {
    if (order.status !== "paid") continue;
    const paymentId = order.razorpay_payment_id;
    if (paymentId === null || paymentId === "") continue;

    const owed = new Map<string, number>();

    for (const g of order.gift_lines ?? []) {
      if (g.from_campaign_id === null) continue;
      owed.set(g.from_campaign_id, (owed.get(g.from_campaign_id) ?? 0) + g.unit_price_paise * g.qty);
    }
    const origins = order.line_origins ?? {};
    for (const line of order.lines) {
      const campaign = origins[line.sku_id];
      if (campaign === undefined) continue;
      owed.set(campaign, (owed.get(campaign) ?? 0) + line.line_total_paise);
    }

    for (const [campaignId, paise] of owed) {
      totals[campaignId] = (totals[campaignId] ?? 0) + paise;
      const key = `${paymentId}|${campaignId}`;
      if (!burned.includes(key)) burned.push(key);
    }
  }

  return { totals, burned };
}
