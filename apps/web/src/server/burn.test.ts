import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cs-burn-"));
  process.env.MERCHANT_OVERLAY_PATH = join(dir, "overlay.json");
  writeFileSync(
    process.env.MERCHANT_OVERLAY_PATH,
    JSON.stringify({
      version: 1,
      products: {},
      campaigns: {},
      created_campaigns: [
        {
          id: "cmp_bogo",
          name: "ONE ON ONE",
          kind: "bogo",
          trigger_sku_ids: ["sku_lipbalm_spf_10"],
          reward_sku_id: "sku_kit_starter",
          suggested_bps: 0,
          budget_paise: 500_000,
          starts_at: "2026-01-01T00:00:00.000Z",
          ends_at: "2027-01-01T00:00:00.000Z",
          active: true,
        },
      ],
    }),
    "utf8",
  );
});

afterEach(() => {
  delete process.env.MERCHANT_OVERLAY_PATH;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A campaign's budget is spent by what it caused, on payments that happened.
 *
 * Three things cost a campaign money, and each is charged to the campaign that
 * caused it rather than to whichever campaign happened to sit on the quote:
 * a gift at its catalog price, a paid line the shopper accepted from that
 * campaign's suggestion, and the coupon rupees on the quote.
 *
 * The burn was previously attributed only to `quote.campaign_id`, and only for
 * shipped campaigns, which is why every merchant-created campaign read zero no
 * matter how well it worked.
 */
describe("campaign burn", () => {
  it("charges a gift at its catalog price to the campaign that gave it", async () => {
    const { recordCampaignSpend, campaignSpentPaise } = await import("@/lib/campaigns");

    expect(campaignSpentPaise("cmp_bogo")).toBe(0);
    recordCampaignSpend("cmp_bogo", 159_900);
    expect(campaignSpentPaise("cmp_bogo")).toBe(159_900);
  });

  it("adds up across separate payments", async () => {
    const { recordCampaignSpend, campaignSpentPaise } = await import("@/lib/campaigns");

    recordCampaignSpend("cmp_bogo", 159_900);
    recordCampaignSpend("cmp_bogo", 39_900);
    expect(campaignSpentPaise("cmp_bogo")).toBe(199_800);
  });

  it("never spends past the budget its owner set", async () => {
    const { recordCampaignSpend, campaignSpentPaise } = await import("@/lib/campaigns");

    recordCampaignSpend("cmp_bogo", 900_000);
    expect(campaignSpentPaise("cmp_bogo")).toBe(500_000);
  });

  it("ignores a campaign it does not know, rather than inventing one", async () => {
    const { recordCampaignSpend, campaignSpentPaise } = await import("@/lib/campaigns");

    recordCampaignSpend("cmp_does_not_exist", 10_000);
    expect(campaignSpentPaise("cmp_does_not_exist")).toBe(0);
  });

  it("ignores zero and negative amounts", async () => {
    const { recordCampaignSpend, campaignSpentPaise } = await import("@/lib/campaigns");

    recordCampaignSpend("cmp_bogo", 0);
    recordCampaignSpend("cmp_bogo", -500);
    expect(campaignSpentPaise("cmp_bogo")).toBe(0);
  });
});

/**
 * The real thing: one paid order, charged to the campaigns that caused it.
 *
 * This is the shape the merchant reported broken — a BOGO gift that reached the
 * cart, the quote and the order, and still left the campaign showing zero spent.
 */
describe("burnForPaidOrder", () => {
  const order = (over: Record<string, unknown> = {}) =>
    ({
      order_id: "qt_x",
      quote_id: "qt_x",
      buyer_user_id: "demo",
      agent_id: "shop_agent",
      razorpay_order_id: "order_x",
      payment_link_id: "plink_x",
      short_url: "https://rzp.io/rzp/x",
      amount_paise: 24_402,
      asked_bps: 200,
      applied_bps: 200,
      offer_id: "offer_TXuWY6xddeXxVe",
      verdict: "ALLOW",
      lines: [
        { sku_id: "sku_lipbalm_spf_10", title: "Lip Balm", qty: 1, line_total_paise: 24_900 },
      ],
      status: "paid",
      razorpay_payment_id: "pay_x",
      created_at: "2026-09-04T00:00:00.000Z",
      paid_at: "2026-09-04T00:01:00.000Z",
      ...over,
    }) as never;

  it("charges a BOGO gift at its catalog price to the campaign that gave it", async () => {
    const { burnForPaidOrder } = await import("./burn");
    const { campaignSpentPaise } = await import("@/lib/campaigns");

    const charges = burnForPaidOrder(order({
        gift_lines: [
          {
            sku_id: "sku_kit_starter",
            title: "Starter Routine Kit",
            qty: 1,
            unit_price_paise: 159_900,
            from_campaign_id: "cmp_bogo",
          },
        ],
      }));

    expect(charges).toEqual([{ campaign_id: "cmp_bogo", paise: 159_900, why: "gift", applied: true }]);
    expect(campaignSpentPaise("cmp_bogo")).toBe(159_900);
  });

  it("does NOT charge an accepted paid suggestion", async () => {
    const { burnForPaidOrder } = await import("./burn");
    const { campaignSpentPaise } = await import("@/lib/campaigns");

    // A suggestion campaign costs the store nothing: the shopper paid the
    // normal price and any discount came from a Razorpay coupon. Charging the
    // campaign for the sale it won made "spent" punish the ones that worked.
    const charges = burnForPaidOrder(
      order({
        lines: [
          { sku_id: "sku_cleanser_gel_100", title: "Cleanser", qty: 1, line_total_paise: 39_900 },
        ],
        line_origins: { sku_cleanser_gel_100: "cmp_bogo" },
      }),
    );

    expect(charges).toEqual([]);
    expect(campaignSpentPaise("cmp_bogo")).toBe(0);
  });

  it("charges nothing when no campaign caused anything", async () => {
    const { burnForPaidOrder } = await import("./burn");
    expect(burnForPaidOrder(order())).toEqual([]);
  });

  it("never charges a gift whose campaign is unknown", async () => {
    const { burnForPaidOrder } = await import("./burn");
    const charges = burnForPaidOrder(order({
        gift_lines: [
          {
            sku_id: "sku_kit_starter",
            title: "Starter Routine Kit",
            qty: 1,
            unit_price_paise: 159_900,
            from_campaign_id: null,
          },
        ],
      }));
    expect(charges).toEqual([]);
  });
});
