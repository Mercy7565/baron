import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Campaign,
  absorbableSpend,
  affordableHintBps,
  hintWithinCeiling,
  nextSpend,
} from "./index";

const REPO = resolve(__dirname, "../../..");

const campaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: "cmp_t",
  name: "T",
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

describe("campaign ceiling cannot be exceeded", () => {
  it("a hint is reduced to what the remaining budget funds, never above it", () => {
    // Across a spread of spend levels, the affordable hint must never let the
    // campaign spend past its ceiling.
    for (const spent of [0, 25_000, 50_000, 95_000, 99_999, 100_000]) {
      const c = campaign({ spent_paise: spent });
      const cart = 100_000;

      const bps = affordableHintBps(c, cart);
      const wouldSpend = Math.floor((cart * bps) / 10_000);

      expect(c.spent_paise + wouldSpend).toBeLessThanOrEqual(c.spend_ceiling_paise);
      expect(bps).toBeLessThanOrEqual(c.max_discount_bps_hint);
      expect(bps).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports blocked when the full hint would breach the ceiling", () => {
    const r = hintWithinCeiling(campaign({ spent_paise: 98_000 }), 100_000, 1500);
    expect(r.allowed).toBe(false);
    expect(r.headroom_paise).toBe(2_000);
  });

  it("an exhausted budget offers nothing at all", () => {
    expect(affordableHintBps(campaign({ spent_paise: 100_000 }), 100_000)).toBe(0);
  });

  it("every campaign in the data file declares a ceiling it has not already blown", () => {
    const file = JSON.parse(
      readFileSync(join(REPO, "apps", "web", "src", "data", "campaigns.json"), "utf8"),
    ) as { campaigns: Campaign[] };

    for (const c of file.campaigns) {
      expect(typeof c.spend_ceiling_paise).toBe("number");
      expect(typeof c.spent_paise).toBe("number");
      expect(c.spent_paise).toBeLessThanOrEqual(c.spend_ceiling_paise);
    }
  });
});

describe("spend recording cannot exceed the ceiling", () => {
  const c = (over: Partial<Campaign> = {}): Campaign => ({
    id: "cmp_burn",
    name: "Burn",
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

  it("adds a granted discount to the budget", () => {
    expect(nextSpend(c(), 12_000)).toBe(12_000);
    expect(nextSpend(c({ spent_paise: 12_000 }), 8_000)).toBe(20_000);
  });

  it("clamps at the ceiling no matter how large the grant", () => {
    // Repeated grants must converge on the ceiling, never pass it.
    let campaign = c();
    for (let i = 0; i < 50; i++) {
      campaign = { ...campaign, spent_paise: nextSpend(campaign, 9_000) };
      expect(campaign.spent_paise).toBeLessThanOrEqual(campaign.spend_ceiling_paise);
    }
    expect(campaign.spent_paise).toBe(100_000);
  });

  it("a single oversized grant still stops at the ceiling", () => {
    expect(nextSpend(c({ spent_paise: 95_000 }), 999_999)).toBe(100_000);
    expect(absorbableSpend(c({ spent_paise: 95_000 }), 999_999)).toBe(5_000);
  });

  it("an exhausted budget absorbs nothing further", () => {
    expect(nextSpend(c({ spent_paise: 100_000 }), 5_000)).toBe(100_000);
    expect(absorbableSpend(c({ spent_paise: 100_000 }), 5_000)).toBe(0);
  });

  it("ignores negative or fractional grants rather than crediting the budget", () => {
    expect(nextSpend(c({ spent_paise: 40_000 }), -10_000)).toBe(40_000);
    expect(nextSpend(c({ spent_paise: 40_000 }), 1_500.9)).toBe(41_500);
  });
});
