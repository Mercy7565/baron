import { describe, expect, it } from "vitest";

import { type Catalog, priceCart } from "@countersign/catalog";

import catalogJson from "../../../apps/web/src/data/catalog.json";
import campaignsJson from "../../../apps/web/src/data/campaigns.json";

import {
  type Campaign,
  type CampaignFile,
  affordableHintBps,
  hintWithinCeiling,
  inWindow,
  pick,
} from "./index";

const CATALOG = catalogJson as Catalog;
const ALL = (campaignsJson as CampaignFile).campaigns;

const NOW = new Date("2026-08-31T00:00:00.000Z");

const cartWith = (...ids: string[]) => priceCart(CATALOG, ids.map((id) => ({ sku_id: id, qty: 1 })));

describe("campaign orchestrator", () => {
  it("picks a campaign whose target matches the cart", () => {
    const result = pick(ALL, CATALOG, cartWith("sku_serum_niacin_30"), NOW);

    expect(result.campaign).not.toBeNull();
    expect(result.eligible.map((c) => c.id)).toContain("cmp_serum_push");
  });

  it("never sums hints when two campaigns match — one winner only", () => {
    // A serum pushes past ₹1000, so both the serum and basket campaigns match.
    const cart = cartWith("sku_serum_vitc_30");
    const result = pick(ALL, CATALOG, cart, NOW);

    expect(result.eligible.length).toBeGreaterThan(1);
    expect(result.stacking).toBe(true);
    // Exactly one campaign is carried forward, and it is the highest hint.
    expect(result.campaign?.max_discount_bps_hint).toBe(
      Math.max(...result.eligible.map((c) => c.max_discount_bps_hint)),
    );
  });

  it("ignores a campaign outside its window", () => {
    const result = pick(ALL, CATALOG, cartWith("sku_lipbalm_spf_10"), NOW);

    expect(result.stale.map((c) => c.id)).toContain("cmp_diwali_2025");
    expect(result.eligible.map((c) => c.id)).not.toContain("cmp_diwali_2025");
  });

  it("ignores an inactive campaign even inside its window", () => {
    const result = pick(ALL, CATALOG, cartWith("sku_eye_peptide_15"), NOW);

    expect(result.eligible.map((c) => c.id)).not.toContain("cmp_paused_eye");
  });

  it("window arithmetic is inclusive of both ends", () => {
    const c = ALL.find((x) => x.id === "cmp_diwali_2025");
    expect(c).toBeDefined();
    if (c === undefined) return;

    expect(inWindow(c, new Date("2025-10-15T00:00:00.000Z"))).toBe(true);
    expect(inWindow(c, NOW)).toBe(false);
  });

  it("a campaign hint is only ever a hint — it carries no offer id", () => {
    const result = pick(ALL, CATALOG, cartWith("sku_serum_niacin_30"), NOW);
    const carried = JSON.stringify(result.campaign);

    // Nothing resembling a Razorpay offer id may appear in campaign data.
    expect(carried).not.toContain("offer_");
  });
});

describe("spend ceiling", () => {
  const campaign = (over: Partial<Campaign> = {}): Campaign => ({
    id: "cmp_test",
    name: "Test",
    window_start: "2026-01-01T00:00:00.000Z",
    window_end: "2027-01-01T00:00:00.000Z",
    target: { kind: "min_cart_paise", min_cart_paise: 1 },
    intent: "attach_max_legal_rung",
    max_discount_bps_hint: 1500,
    active: true,
    spend_ceiling_paise: 100_000,
    spent_paise: 0,
    ...over,
  });

  it("allows a hint the remaining budget can fund", () => {
    // 15% of 100000 = 15000, well inside a 100000 ceiling.
    const r = hintWithinCeiling(campaign(), 100_000, 1500);
    expect(r.allowed).toBe(true);
    expect(r.projected_discount_paise).toBe(15_000);
  });

  it("refuses a hint that would breach the ceiling", () => {
    const r = hintWithinCeiling(campaign({ spent_paise: 95_000 }), 100_000, 1500);
    expect(r.allowed).toBe(false);
    expect(r.headroom_paise).toBe(5_000);
  });

  it("reduces the hint to what the budget can still afford", () => {
    // 5000 headroom on a 100000 cart is 500 bps, not the 1500 the campaign wants.
    expect(affordableHintBps(campaign({ spent_paise: 95_000 }), 100_000)).toBe(500);
  });

  it("never offers more than the campaign's own hint even with budget to spare", () => {
    expect(affordableHintBps(campaign({ spend_ceiling_paise: 10_000_000 }), 100_000)).toBe(1500);
  });

  it("offers nothing once the budget is spent", () => {
    expect(affordableHintBps(campaign({ spent_paise: 100_000 }), 100_000)).toBe(0);
  });
});
