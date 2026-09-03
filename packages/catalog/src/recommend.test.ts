import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { type Catalog, recommendationCandidates } from "./index";

import catalogJson from "../../../apps/web/src/data/catalog.json";

const CATALOG = catalogJson as Catalog;
const REPO = resolve(__dirname, "../../..");
const IDS = new Set(CATALOG.products.map((p) => p.id));

describe("recommender never invents a SKU", () => {
  it("every candidate is a real catalog id, for every single-item cart", () => {
    for (const p of CATALOG.products) {
      for (const rec of recommendationCandidates(CATALOG, [{ sku_id: p.id, qty: 1 }])) {
        expect(IDS.has(rec.id)).toBe(true);
        // And never something that cannot be sold.
        expect(rec.blocked).toBe(false);
        expect(rec.availability).toBe("in_stock");
      }
    }
  });

  it("never recommends something already in the basket", () => {
    const lines = [
      { sku_id: "sku_serum_niacin_30", qty: 1 },
      { sku_id: "sku_spf_fluid_50", qty: 1 },
    ];
    const ids = recommendationCandidates(CATALOG, lines).map((r) => r.id);

    expect(ids).not.toContain("sku_serum_niacin_30");
    expect(ids).not.toContain("sku_spf_fluid_50");
  });

  it("every curated edge in the catalog points at a real product", () => {
    for (const p of CATALOG.products) {
      for (const id of [...p.complements, ...p.upgrades, ...p.frequently_bought_with]) {
        expect(IDS.has(id)).toBe(true);
      }
    }
  });

  it("an unknown sku yields no recommendations rather than guessing", () => {
    expect(recommendationCandidates(CATALOG, [{ sku_id: "sku_not_real", qty: 1 }])).toEqual([]);
  });

  it("the wallet copy never claims a capture happened", () => {
    const copy = readFileSync(join(REPO, "apps", "web", "src", "lib", "copy.ts"), "utf8");

    // The sentence that goes on camera.
    expect(copy).toContain(
      "Saved for a future server charge. Today you pay the link.",
    );

    // And it must not claim an OTP completed a Razorpay payment.
    expect(copy.toLowerCase()).not.toContain("otp");
    expect(copy).not.toContain("captured");
  });
});
