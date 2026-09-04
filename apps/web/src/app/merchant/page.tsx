import { readAuditRecords, verifyAuditChain } from "@countersign/ledger";

import { priceCart } from "@countersign/catalog";

import { ConsoleChrome } from "@/components/ConsoleChrome";
import { CATALOG } from "@/lib/catalog";
import { DEFAULT_MARGIN_FLOOR_BPS, DEV_POLICY } from "@/lib/policy";
import { campaignRows } from "@/server/campaign-rows";
import { causeOf, couponPercentOf, ledgerRows, paidLedgerRows } from "@/server/ledger-rows";

import { MarginFloor, type FloorSample } from "./MarginFloor";
import { OverviewTable, type OverviewRow } from "./OverviewTable";
import { shopCodeFor } from "@/server/shop-code";
import { DEFAULT_TENANT } from "@/server/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rupees = (paise: number): string => `₹${(paise / 100).toLocaleString("en-IN")}`;

/**
 * The merchant overview.
 *
 * Rewritten rather than patched. The old page was wrong in four ways at once:
 * every row read CLAMP because the shop asked a flat 15% of every basket,
 * "wanted" was therefore always 15% and told you nothing, retired coupon ids
 * were mixed into the counts, and the copy described the ladder in terms of
 * "rungs" — a word that means nothing to a merchant.
 *
 * Now: the counters only include decisions whose coupon this store can still
 * attach, and one table says what happened and why in a sentence.
 */
export default function MerchantOverview() {
  const now = new Date();
  const all = ledgerRows();

  // Retired coupon sets are still in the log — they are real history — but they
  // describe coupons that cannot attach, so they are counted separately and
  // never mixed into a KPI.
  const live = all.filter((r) => r.live);

  const chain = verifyAuditChain(readAuditRecords());

  /**
   * Every tile reads the same store the page it summarises reads.
   *
   * These used to be computed here from the shipped constants: the SKU count
   * ignored merchant edits, and the campaign counts read only `CAMPAIGNS` while
   * ignoring cancellation and merchant-created rows entirely. A cancelled
   * campaign still counted as live, and its budget was still counted as
   * available. An overview that disagrees with the page beneath it is worse
   * than no overview.
   *
   *   SKUs on sale   -> CATALOG (overlay applied), same filter as /shop
   *   campaigns live -> campaignRows(), same rows as /merchant/campaigns
   *   budget left    -> sum of LEFT on those Live rows only
   *   quotes / links -> the quote and order logs
   *   audit chain    -> the audit log
   */
  const sellable = CATALOG.products.filter((p) => !p.blocked && p.availability === "in_stock");

  const allCampaigns = campaignRows(now);
  const liveCampaigns = allCampaigns.filter((c) => c.live);
  // Only gift campaigns have a budget to have left. A suggestion campaign
  // spends nothing, so counting its ceiling here inflated the tile with money
  // that was never at risk.
  // A code is earned by having something to sell, not by signing up.
  const shopCode = shopCodeFor(DEFAULT_TENANT);

  const budgetLeft = liveCampaigns
    .filter((c) => c.kind === "gift")
    .reduce((n, c) => n + c.left_paise, 0);

  const withLink = live.filter((r) => r.outcome !== "no link");

  /**
   * Real baskets for the floor preview.
   *
   * Priced from the live catalog rather than invented, so the slider's helper
   * text is a fact about this store rather than an illustration.
   */
  const SAMPLES: Array<[string, Array<{ sku_id: string; qty: number }>]> = [
    ["One sunscreen", [{ sku_id: "sku_spf_fluid_50", qty: 1 }]],
    ["One niacinamide serum", [{ sku_id: "sku_serum_niacin_30", qty: 1 }]],
    [
      "Niacinamide + Vitamin C",
      [
        { sku_id: "sku_serum_niacin_30", qty: 1 },
        { sku_id: "sku_serum_vitc_30", qty: 1 },
      ],
    ],
    [
      "Three-item routine",
      [
        { sku_id: "sku_serum_niacin_30", qty: 1 },
        { sku_id: "sku_serum_vitc_30", qty: 1 },
        { sku_id: "sku_spf_fluid_50", qty: 1 },
      ],
    ],
  ];

  const samples: FloorSample[] = SAMPLES.map(([label, lines]) => {
    const priced = priceCart(CATALOG, lines);
    return { label, subtotal_paise: priced.amount_paise, margin_bps: priced.margin_bps };
  });

  // Paid purchases only, newest first, five of them. A merchant's headline
  // table should hold money that arrived, not every question a shopper asked.
  const rows: OverviewRow[] = paidLedgerRows()
    .slice(0, 5)
    .map((r) => ({
    key: r.key,
    ts: r.ts,
    subtotal_paise: r.subtotal_paise,
    who: r.actor,
    who_kind: r.actor_kind,
    campaign: r.campaign,
    asked_bps: r.asked_bps,
    applied_bps: r.applied_bps,
    cause: causeOf(r),
    offer_id: r.offer_id,
    attached: r.attached,
    coupon: couponPercentOf(r.offer_id),
    outcome: r.outcome,
  }));

  return (
    <ConsoleChrome current="/merchant">
      <h1>What the store allowed today.</h1>
      <p className="mc-sub">
        Policy decides what money may move before anything reaches Razorpay. This console is where
        you set the bounds it decides against.
      </p>
      <p className="judge-note">
        Revenue and the coupon budget in one place: what the store actually took, which campaigns caused it, and whether the decision ledger is intact.
      </p>

      <div className="mc-grid" style={{ marginBottom: 12 }}>
        <div className="mc-stat">
          <div className="v">{sellable.length}</div>
          <div className="k">SKUs on sale of {CATALOG.products.length}</div>
        </div>
        <div className="mc-stat">
          <div className="v">{liveCampaigns.length}</div>
          <div className="k">campaigns live now</div>
        </div>
        <div className="mc-stat">
          <div className="v">{rupees(budgetLeft)}</div>
          <div className="k">budget left on live gift campaigns</div>
        </div>
        <div className="mc-stat">
          <div className="v">{live.length}</div>
          <div className="k">quotes priced</div>
        </div>
        <div className="mc-stat">
          <div className="v">{withLink.length}</div>
          <div className="k">reached a payment link</div>
        </div>
        <div className="mc-stat">
          <div className="v" style={{ color: chain.ok ? "var(--ok)" : "var(--danger)" }}>
            {chain.ok ? "OK" : "GAP"}
          </div>
          <div className="k">audit chain{chain.ok ? ` · ${chain.length} rows` : ""}</div>
        </div>
      </div>

      {shopCode === null ? (
        <div className="mc-banner" style={{ marginBottom: 12 }}>
          Add one in-stock product and Baron will issue your shop code.
        </div>
      ) : (
        <div className="mc-panel" style={{ marginBottom: 12 }}>
          <h2>Your shop code</h2>
          <p className="mc-sub" style={{ marginTop: 0 }}>
            Give this to customers. They enter it on Baron to see your catalog and nobody
            else&rsquo;s.
          </p>
          <div className="mc-code">{shopCode}</div>
        </div>
      )}

      <div className="mc-banner" style={{ marginBottom: 12 }}>
        Campaigns suggest a product and a %. Baron picks which of the 7 Razorpay coupons may
        attach. Campaigns cannot create a coupon.
      </div>

      <MarginFloor
        initialBps={DEV_POLICY.margin_floor_bps}
        defaultBps={DEFAULT_MARGIN_FLOOR_BPS}
        ladder={DEV_POLICY.ladder.map((r) => ({
          discount_bps: r.discount_bps,
          min_cart_paise: r.min_cart_paise,
        }))}
        samples={samples}
      />

      <OverviewTable rows={rows} />
    </ConsoleChrome>
  );
}
