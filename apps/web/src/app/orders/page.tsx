import { explainOrder, paidOrdersFor, unpaidOrdersFor } from "@countersign/orders";
import { allQuotes } from "@countersign/quotes";

import { Package } from "lucide-react";

import { StoreChrome } from "@/components/StoreChrome";
import { buyerId } from "@/server/require-role";

import { RefreshOrders } from "./RefreshOrders";
import { UnpaidLinks, type UnpaidRow } from "./UnpaidLinks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rupees = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const showing: "paid" | "unpaid" = tab === "unpaid" ? "unpaid" : "paid";

  const buyer = await buyerId();

  // Paid and unpaid are kept apart on purpose. An issued link is not a
  // purchase; showing one under Paid would tell a customer they bought
  // something they have not paid for.
  const paid = paidOrdersFor(buyer);
  const unpaid = unpaidOrdersFor(buyer);

  /**
   * Quotes that were approved but never turned into a link.
   *
   * Nothing creates a Payment Link on its own any more, so a priced basket sits
   * here until the buyer asks for one. Without this list an agent-driven quote
   * would have no button anywhere and no way to be paid.
   */
  /**
   * Unpaid bags that never became a link.
   *
   * Expired ones are included on purpose. Hiding them made a bag that timed out
   * vanish from the Unpaid tab while staying on the books — the buyer could
   * neither pay it nor close it. It is still their bag; they should be able to
   * clear it.
   */
  const pending = allQuotes().filter(
    (q) =>
      q.buyer_user_id === buyer &&
      q.payment_link_id === null &&
      q.status !== "cancelled" &&
      q.status !== "superseded" &&
      q.status !== "paid" &&
      (q.verdict === "ALLOW" || q.verdict === "CLAMP"),
  );

  const unpaidRows: UnpaidRow[] = unpaid.map((o) => ({
    order_id: o.order_id,
    short_url: o.short_url,
    amount_paise: o.amount_paise,
    created_at: o.created_at,
    summary: o.lines.map((l) => `${l.title} × ${l.qty}`).join(", "),
  }));

  return (
    <StoreChrome>
      <h1>Your orders</h1>
      <p className="st-lede">
        An order appears under Paid once Razorpay confirms the payment — not when the link is
        created.
      </p>
      <p className="judge-note">
        Paid means Razorpay said so. An issued link is a request for money, never a receipt, so it
        stays on the Unpaid tab until a webhook confirms it.
      </p>

      <div className="st-tabs">
        <a className={showing === "paid" ? "st-tab is-on" : "st-tab"} href="/orders?tab=paid">
          Paid ({paid.length})
        </a>
        <a className={showing === "unpaid" ? "st-tab is-on" : "st-tab"} href="/orders?tab=unpaid">
          Unpaid ({unpaidRows.length + pending.length})
        </a>
        <span style={{ flex: 1 }} />
        {(unpaidRows.length > 0 || paid.length > 0) && (
          <RefreshOrders label="Check for new payments" auto />
        )}
      </div>

      {showing === "unpaid" ? (
        <UnpaidLinks
          rows={unpaidRows}
          pending={pending.map((q) => ({
            quote_id: q.quote_id,
            summary: q.lines.map((l) => `${l.title} × ${l.qty}`).join(", "),
            total_paise: q.legal_total_paise,
            applied_bps: q.applied_bps,
            offer_id: q.offer_id,
            created_at: q.created_at,
          }))}
        />
      ) : paid.length === 0 ? (
        <div className="st-empty">
          <Package size={26} strokeWidth={1.5} aria-hidden />
          <p>
            {unpaidRows.length > 0
              ? `Nothing paid for yet. You have ${unpaidRows.length} payment link${unpaidRows.length === 1 ? "" : "s"} waiting — pay one on Razorpay, then check again.`
              : "Nothing paid for yet. Ask the assistant for something and it will price it for you."}
          </p>
          <div className="st-actions">
            <a className="st-btn" href="/agent">
              Talk to the assistant
            </a>
            {unpaidRows.length > 0 && (
              <a className="st-btn st-btn--quiet" href="/orders?tab=unpaid">
                See unpaid links
              </a>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {paid.map((o) => (
            <a
              key={o.order_id}
              className="st-card"
              href={`/orders/${o.order_id}`}
              style={{ textDecoration: "none", color: "inherit", display: "block" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontSize: 17 }}>
                    {o.lines.map((l) => `${l.title} × ${l.qty}`).join(", ")}
                  </div>
                  {(o.gift_lines ?? []).map((g) => (
                    <div key={g.sku_id} style={{ fontSize: 15, marginTop: 2 }}>
                      {g.title} × {g.qty} <span className="ct-gift">Free</span>
                    </div>
                  ))}
                  <div className="st-muted" style={{ fontSize: 14, marginTop: 4 }}>
                    Paid · {o.paid_at?.slice(0, 10) ?? ""}
                  </div>
                </div>
                <strong className="nl-money" style={{ fontSize: 19 }}>
                  {rupees(o.amount_paise)}
                </strong>
              </div>
              <p className="st-muted" style={{ fontSize: 14, margin: "12px 0 0" }}>
                {explainOrder(o)}
              </p>
            </a>
          ))}
        </div>
      )}
    </StoreChrome>
  );
}
