/**
 * @countersign/campaigns
 *
 * The growth engine, kept on a short leash.
 *
 * A campaign is a *hint*: it can say "this cart is worth pushing" and suggest a
 * ceiling, but it is never a source of offer ids and never a source of
 * authority. The kernel reads the ladder and the margin floor; it does not read
 * campaigns. If a campaign hints 15% and the floor allows 5%, the buyer gets
 * 5%, and the campaign id is recorded next to that fact.
 */
import { type Catalog, type PricedCart, productById } from "@countersign/catalog";

export const CAMPAIGNS_VERSION = "0.1.0" as const;

export type CampaignIntent = "attach_max_legal_rung" | "suggest_bundle" | "none";

export type CampaignTarget =
  | { kind: "sku"; sku_ids: string[] }
  | { kind: "category"; category: string }
  | { kind: "min_cart_paise"; min_cart_paise: number };

export interface Campaign {
  id: string;
  name: string;
  window_start: string;
  window_end: string;
  target: CampaignTarget;
  intent: CampaignIntent;
  /** A hint, and only a hint. The kernel may grant less. It may never grant more. */
  max_discount_bps_hint: number;
  active: boolean;
  /** Total discount budget, in paise, this campaign may ever give away. */
  spend_ceiling_paise: number;
  /** Spent so far. A hint is only offered while headroom remains. */
  spent_paise: number;
}

export interface CampaignFile {
  campaigns: Campaign[];
}

export function inWindow(campaign: Campaign, now: Date): boolean {
  const start = Date.parse(campaign.window_start);
  const end = Date.parse(campaign.window_end);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  const t = now.getTime();
  return t >= start && t <= end;
}

function matchesCart(campaign: Campaign, catalog: Catalog, cart: PricedCart): boolean {
  const target = campaign.target;

  if (target.kind === "sku") {
    return cart.product_ids.some((id) => target.sku_ids.includes(id));
  }

  if (target.kind === "category") {
    return cart.product_ids.some((id) => {
      const p = productById(catalog, id);
      return p !== null && p.category.includes(target.category);
    });
  }

  return cart.amount_paise >= target.min_cart_paise;
}

export interface PickResult {
  /** The single campaign whose hint will be carried into the proposal. */
  campaign: Campaign | null;
  /** Every campaign that matched, before the single-winner rule was applied. */
  eligible: Campaign[];
  /** True when more than one campaign matched — recorded as campaign_stacking. */
  stacking: boolean;
  /** Campaigns that matched the cart but were outside their window. */
  stale: Campaign[];
  /** One sentence for the transcript and the audit reasons. */
  note: string;
}

/**
 * Choose at most one campaign.
 *
 * Stacking is the thing to prevent: two campaigns that each look reasonable can
 * compound into a discount nobody approved. We never sum hints. We take the
 * single highest hint and let the kernel clamp it — so the worst case of a
 * stacking bug is that the buyer gets one legal rung.
 */
export function pick(
  campaigns: Campaign[],
  catalog: Catalog,
  cart: PricedCart,
  now: Date,
): PickResult {
  const matching = campaigns.filter((c) => matchesCart(c, catalog, cart));

  const stale = matching.filter((c) => c.active && !inWindow(c, now));
  const eligible = matching.filter(
    (c) => c.active && inWindow(c, now) && c.intent !== "none",
  );

  if (eligible.length === 0) {
    return {
      campaign: null,
      eligible,
      stacking: false,
      stale,
      note:
        stale.length > 0
          ? `No live campaign. ${stale.length} matched but sit outside their window and were ignored.`
          : "No campaign applies to this cart.",
    };
  }

  // Highest hint wins; ties break on id so the choice is deterministic.
  const sorted = [...eligible].sort((a, b) =>
    b.max_discount_bps_hint !== a.max_discount_bps_hint
      ? b.max_discount_bps_hint - a.max_discount_bps_hint
      : a.id < b.id
        ? -1
        : 1,
  );
  const winner = sorted[0] ?? null;
  const stacking = eligible.length > 1;

  return {
    campaign: winner,
    eligible,
    stacking,
    stale,
    note: stacking
      ? `${eligible.length} campaigns matched. Hints are never summed — only ${winner?.id ?? "?"} is carried, and the kernel still clamps it.`
      : `Campaign ${winner?.id ?? "?"} applies. Its ${winner?.max_discount_bps_hint ?? 0} bps is a hint, not an entitlement.`,
  };
}

// ------------------------------------------------------------- spend ceiling

/**
 * May this campaign still afford the discount it wants to hint at?
 *
 * A campaign is a budget, not a promise. Once the projected giveaway would
 * carry it past its ceiling, the hint is withheld — the kernel would have
 * clamped anyway, but a campaign that quietly overspends its budget is a
 * merchant-side failure even when every individual order was legal.
 */
export function hintWithinCeiling(
  campaign: Campaign,
  cartAmountPaise: number,
  hintBps: number,
): { allowed: boolean; projected_discount_paise: number; headroom_paise: number } {
  const projected = Math.floor((cartAmountPaise * hintBps) / 10_000);
  const headroom = campaign.spend_ceiling_paise - campaign.spent_paise;

  return {
    allowed: campaign.spent_paise + projected <= campaign.spend_ceiling_paise,
    projected_discount_paise: projected,
    headroom_paise: headroom,
  };
}

/**
 * The highest hint this campaign can still afford on this cart, rounded down to
 * a whole basis point. Zero when the budget is exhausted.
 */
export function affordableHintBps(campaign: Campaign, cartAmountPaise: number): number {
  if (cartAmountPaise <= 0) return 0;
  const headroom = Math.max(0, campaign.spend_ceiling_paise - campaign.spent_paise);
  const maxBps = Math.floor((headroom * 10_000) / cartAmountPaise);
  return Math.min(campaign.max_discount_bps_hint, maxBps);
}

// ------------------------------------------------------------- spend tracking

/**
 * The campaign's spend after granting `discountPaise`, never above its ceiling.
 *
 * A campaign is a budget, and a budget that can be overspent is not one. The
 * clamp lives here, as a pure function, so the ceiling is enforced by the same
 * code the tests exercise rather than by whoever remembers to check.
 */
export function nextSpend(campaign: Campaign, discountPaise: number): number {
  const added = Math.max(0, Math.floor(discountPaise));
  return Math.min(campaign.spend_ceiling_paise, campaign.spent_paise + added);
}

/** How much of a grant the budget can actually absorb. */
export function absorbableSpend(campaign: Campaign, discountPaise: number): number {
  return nextSpend(campaign, discountPaise) - campaign.spent_paise;
}
