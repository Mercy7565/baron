import campaignsJson from "@/data/campaigns.json";

import type { Campaign, CampaignFile } from "@countersign/campaigns";

import { nextSpend } from "@countersign/campaigns";

import {
  applyCampaignOverlay,
  createdCampaigns,
  readOverlay,
  setCampaignOverlay,
} from "@/server/overlay";

const BASE_CAMPAIGNS: Campaign[] = (campaignsJson as CampaignFile).campaigns;

/** Campaigns with merchant console edits (ceilings, spend, active) applied. */
export function campaigns(): Campaign[] {
  return applyCampaignOverlay(BASE_CAMPAIGNS);
}

/** Kept for existing callers; reads through the overlay on every access. */
export const CAMPAIGNS: Campaign[] = new Proxy([] as Campaign[], {
  get(_t, prop, receiver) {
    const live = campaigns();
    const value = Reflect.get(live, prop, receiver);
    return typeof value === "function" ? value.bind(live) : value;
  },
});

/**
 * Whether a seeded campaign is switched on.
 *
 * These used to be a Map on `globalThis` — pausing a campaign held only for
 * the instance that served the click, so the merchant saw it resume by itself
 * on the next request and a shopper could still be offered a campaign that had
 * been turned off. The answer now comes from the merchant overlay, which is
 * durable, and the shipped JSON stays the declared default.
 */
export function isCampaignActive(id: string): boolean {
  const override = readOverlay().campaigns[id]?.active;
  if (override !== undefined) return override;
  return CAMPAIGNS.find((c) => c.id === id)?.active ?? false;
}

export function setCampaignActive(id: string, active: boolean): boolean {
  setCampaignOverlay(id, { active });
  return active;
}

export function campaignById(id: string): Campaign | null {
  return CAMPAIGNS.find((c) => c.id === id) ?? null;
}

/**
 * Record a discount actually granted against a campaign's budget.
 *
 * Called only when Razorpay confirms a payment — never on a suggestion and
 * never when a link is created, because neither of those is money leaving the
 * store. Written to the overlay so the console shows real burn, and clamped at
 * the ceiling so a campaign can never overspend the budget its owner set.
 *
 * Handles campaigns the merchant created as well as the shipped ones: a burn
 * that silently skipped created campaigns is why every one of them read zero.
 */
export function recordCampaignSpend(campaignId: string | null, amountPaise: number): void {
  if (campaignId === null || amountPaise <= 0) return;

  const seed = campaigns().find((c) => c.id === campaignId);
  if (seed !== undefined) {
    const updated = nextSpend(seed, amountPaise);
    if (updated === seed.spent_paise) return;
    setCampaignOverlay(campaignId, { spent_paise: updated });
    return;
  }

  const mine = createdCampaigns().find((c) => c.id === campaignId);
  if (mine === undefined) return;

  const already = campaignSpentPaise(campaignId);
  const capped = Math.min(mine.budget_paise, already + Math.floor(amountPaise));
  if (capped === already) return;
  setCampaignOverlay(campaignId, { spent_paise: capped });
}

/** What a campaign has spent so far, seed or merchant-created. */
export function campaignSpentPaise(campaignId: string): number {
  const seed = campaigns().find((c) => c.id === campaignId);
  if (seed !== undefined) return seed.spent_paise;
  return readOverlay().campaigns[campaignId]?.spent_paise ?? 0;
}
