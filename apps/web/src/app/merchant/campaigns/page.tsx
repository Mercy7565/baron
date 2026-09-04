import { type Campaign, inWindow } from "@countersign/campaigns";
import { allOrders } from "@countersign/orders";
import { allQuotes } from "@countersign/quotes";

import { ConsoleChrome } from "@/components/ConsoleChrome";
import { CAMPAIGNS, campaignSpentPaise, isCampaignActive } from "@/lib/campaigns";
import { CATALOG } from "@/lib/catalog";
import { campaignRows } from "@/server/campaign-rows";

import { CreateCampaign, type SkuOption } from "./CreateCampaign";
import { RowControls } from "./RowControls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rupees = (paise: number): string => `₹${(paise / 100).toLocaleString("en-IN")}`;

/**
 * A readable date. The year is always shown, because a window that ran
 * "1 Jan – 1 Jan" told a merchant nothing — those were two different years.
 */
const day = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${d.toLocaleString("en-IN", { month: "short" })} ${d.getFullYear()}`;
};

type State = "Live" | "Paused" | "Ended" | "Cancelled";

function stateOf(c: { window_start: string; window_end: string; active: boolean }, now: Date): State {
  if (Date.parse(c.window_end) < now.getTime()) return "Ended";
  if (!c.active) return "Paused";
  return inWindow(c as Campaign, now) ? "Live" : "Paused";
}

/** What this campaign suggests, in words a merchant wrote. */
function suggests(c: Campaign): string {
  const t = c.target;
  if (t.kind === "sku") {
    return t.sku_ids
      .map((id) => CATALOG.products.find((p) => p.id === id)?.title ?? id)
      .join(", ");
  }
  if (t.kind === "category") return `anything in ${t.category}`;
  return `baskets over ${rupees(t.min_cart_paise)}`;
}

export default function MerchantCampaigns() {
  const now = new Date();
  const quotes = allQuotes();

  /**
   * Spend comes from the one campaign store.
   *
   * It used to be recomputed here from `quote.campaign_id` plus coupon rupees,
   * which is a third notion of spend that disagreed with both the burn and
   * `campaignSpentPaise`. A merchant-created BOGO never sets `quote.campaign_id`
   * at all, so its spend was structurally always zero however well it worked.
   */
  const paid = allOrders().filter((o) => o.status === "paid");
  const spentOn = (campaignId: string): number => campaignSpentPaise(campaignId);

  /** Paid orders this campaign actually caused — a gift, or a suggestion taken. */
  const salesOn = (campaignId: string): number =>
    paid.filter(
      (o) =>
        (o.gift_lines ?? []).some((g) => g.from_campaign_id === campaignId) ||
        Object.values(o.line_origins ?? {}).includes(campaignId),
    ).length;

  const skus: SkuOption[] = CATALOG.products
    .filter((p) => !p.blocked)
    .map((p) => ({ id: p.id, title: p.title }));

  // The same rows the overview counts, so the two pages cannot disagree.
  const table = campaignRows(now).map((c) => ({
    id: c.id,
    name: c.name,
    cancelled: c.state === "Cancelled",
    state: c.state,
    suggests:
      c.reward_sku_id !== null
        ? (CATALOG.products.find((p) => p.id === c.reward_sku_id)?.title ?? c.reward_sku_id)
        : c.trigger_sku_ids
            .map((id) => CATALOG.products.find((p) => p.id === id)?.title ?? id)
            .join(", ") || "—",
    // A campaign whose reward has been taken off the shop cannot suggest it.
    reward_missing:
      c.reward_sku_id !== null &&
      !CATALOG.products.some(
        (p) => p.id === c.reward_sku_id && !p.blocked && p.availability === "in_stock",
      ),
    window: `${day(c.starts_at)} – ${day(c.ends_at)}`,
    budget: c.budget_paise,
    spent: c.spent_paise,
    left: c.left_paise,
    sales: salesOn(c.id),
  }));

  return (
    <ConsoleChrome current="/merchant/campaigns">
      <h1>Campaigns</h1>
      <p className="mc-sub">
        You set the budget and the margin you must keep. The assistant suggests products. Razorpay
        coupons still do the discount. We only count budget after a customer actually pays.
      </p>

      <CreateCampaign skus={skus} />

      <div className="mc-panel" style={{ marginBottom: 12 }}>
        <h2>Your campaigns</h2>
        <table className="mc-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Suggests</th>
              <th>Dates</th>
              <th>State</th>
              <th className="num">Budget</th>
              <th className="num">Spent</th>
              <th className="num">Left</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {table.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name}
                  <div className="mc-tiny">
                    {c.sales === 0 ? "no sales yet" : `${c.sales} paid sale${c.sales === 1 ? "" : "s"}`}
                  </div>
                </td>
                <td style={{ maxWidth: 240 }}>
                  {c.suggests}
                  {c.reward_missing && <div className="mc-tiny">SKU removed</div>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{c.window}</td>
                <td>
                  <span
                    className="mc-pill"
                    data-tone={
                      c.state === "Live"
                        ? "live"
                        : c.state === "Ended" || c.state === "Cancelled"
                          ? "blocked"
                          : "paused"
                    }
                  >
                    {c.state}
                  </span>
                </td>
                <td className="num">{rupees(c.budget)}</td>
                <td className="num">{rupees(c.spent)}</td>
                <td className="num">
                  <strong>{rupees(c.left)}</strong>
                </td>
                <td>
                  <RowControls
                    id={c.id}
                    paused={c.state === "Paused"}
                    ended={c.state === "Ended"}
                    cancelled={c.cancelled}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </ConsoleChrome>
  );
}
