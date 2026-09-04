import { type Campaign, inWindow } from "@countersign/campaigns";

import { CAMPAIGNS, campaignSpentPaise, isCampaignActive } from "@/lib/campaigns";
import { cancelledSeedIds, createdCampaigns } from "@/server/overlay";

/**
 * Every campaign the store has, seed and merchant-created, in one shape.
 *
 * The overview and the campaigns page used to compute this separately: the
 * overview read only the shipped `CAMPAIGNS` and ignored cancellation, so a
 * cancelled campaign still counted as live and a merchant-created one never
 * counted at all. Two pages describing the same store disagreed, and the one a
 * merchant checked first was the wrong one.
 *
 * One function, one answer. Both pages render from this.
 */
export type CampaignState = "Live" | "Paused" | "Ended" | "Cancelled";

/**
 * Two kinds of campaign, and they cost the store differently.
 *
 *   gift        A merchant campaign that hands over a product. The store pays
 *               for it, at catalog price, so it has a budget and that budget is
 *               spent on every paid gift.
 *
 *   suggestion  A campaign that only points the assistant at a product. Nothing
 *               is given away: the shopper pays the normal price and any
 *               discount is a Razorpay coupon the kernel chose. There is no
 *               spend to track, so a Budget/Spent/Left column on one of these
 *               was always going to read zero and look broken.
 *
 * Coupon rupees are not campaign spend. A suggestion campaign that leads to a
 * sale has made the store money, not cost it any.
 */
export type CampaignKind = "gift" | "suggestion";

export interface CampaignRowData {
  id: string;
  name: string;
  kind: CampaignKind;
  state: CampaignState;
  /** True only for Live: active, inside its window, not paused or cancelled. */
  live: boolean;
  budget_paise: number;
  spent_paise: number;
  left_paise: number;
  starts_at: string;
  ends_at: string;
  /** The SKU this campaign rewards with, when it has one. */
  reward_sku_id: string | null;
  trigger_sku_ids: string[];
  source: "seed" | "created";
}

function stateOf(
  starts: string,
  ends: string,
  active: boolean,
  cancelled: boolean,
  now: Date,
): CampaignState {
  if (cancelled) return "Cancelled";
  if (Date.parse(ends) < now.getTime()) return "Ended";
  if (!active) return "Paused";
  return inWindow({ window_start: starts, window_end: ends } as Campaign, now) ? "Live" : "Paused";
}

export function campaignRows(now = new Date()): CampaignRowData[] {
  const cancelled = cancelledSeedIds();

  const seed: CampaignRowData[] = CAMPAIGNS.map((c) => {
    const isCancelled = cancelled.has(c.id);
    const state = stateOf(c.window_start, c.window_end, isCampaignActive(c.id), isCancelled, now);
    const spent = campaignSpentPaise(c.id);
    return {
      id: c.id,
      name: c.name,
      // Shipped campaigns only ever suggest; none of them gives anything away.
      kind: "suggestion",
      state,
      live: state === "Live",
      budget_paise: c.spend_ceiling_paise,
      spent_paise: spent,
      left_paise: Math.max(0, c.spend_ceiling_paise - spent),
      starts_at: c.window_start,
      ends_at: c.window_end,
      reward_sku_id: c.target.kind === "sku" ? (c.target.sku_ids[0] ?? null) : null,
      trigger_sku_ids: c.target.kind === "sku" ? [...c.target.sku_ids] : [],
      source: "seed",
    };
  });

  const mine: CampaignRowData[] = createdCampaigns().map((c) => {
    const state = stateOf(c.starts_at, c.ends_at, c.active, c.cancelled === true, now);
    const spent = campaignSpentPaise(c.id);
    return {
      id: c.id,
      name: c.name,
      // Only buy-one-get-one actually gives a product away.
      kind: c.kind === "bogo" ? "gift" : "suggestion",
      state,
      live: state === "Live",
      budget_paise: c.budget_paise,
      spent_paise: spent,
      left_paise: Math.max(0, c.budget_paise - spent),
      starts_at: c.starts_at,
      ends_at: c.ends_at,
      reward_sku_id: c.reward_sku_id,
      trigger_sku_ids: [...c.trigger_sku_ids],
      source: "created",
    };
  });

  return [...seed, ...mine];
}

/** The name behind a campaign id, seed or merchant-created. Null if unknown. */
export function campaignNameOf(id: string | null): string | null {
  if (id === null || id === "") return null;
  return campaignRows().find((c) => c.id === id)?.name ?? null;
}
