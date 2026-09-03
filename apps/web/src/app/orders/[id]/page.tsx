import { notFound } from "next/navigation";

import { explainOrder, getOrder } from "@countersign/orders";

import { StoreChrome } from "@/components/StoreChrome";
import { buyerId } from "@/server/require-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rupees = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;

/**
 * A customer receipt: one order, theirs, in plain language.
 *
 * Deliberately not a storewide table — a customer has no business reading other
 * people's decisions. The merchant's full chain lives at /merchant/audit.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buyer = await buyerId();
  const order = getOrder(id);

  if (order === null || order.buyer_user_id !== buyer) notFound();

  const rows: Array<[string, string]> = [
    ["Discount asked", `${order.asked_bps / 100}%`],
    ["Discount policy allowed", `${order.applied_bps / 100}%`],
    ["Offer applied", order.offer_id ?? "none"],
    ["Total", rupees(order.amount_paise)],
    ["Payment link", order.payment_link_id],
    ["Status", order.status === "paid" ? "Paid" : "Awaiting payment"],
  ];

  if (order.razorpay_payment_id !== null) {
    rows.push(["Razorpay payment", order.razorpay_payment_id]);
  }

  return (
    <StoreChrome>
      <section style={{ padding: "56px 0 28px", maxWidth: "44ch" }}>
        <p className="st-muted" style={{ margin: 0, fontSize: 14 }}>
          Receipt
        </p>
        <h1 style={{ fontSize: 34 }}>
          {order.status === "paid" ? "Paid" : "Awaiting payment"}
        </h1>
        <p className="st-lede">{explainOrder(order)}</p>
      </section>

      <div className="st-card" style={{ maxWidth: 620 }}>
        <div style={{ marginBottom: 18 }}>
          {order.lines.map((l) => (
            <div
              key={l.sku_id}
              style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}
            >
              <span>
                {l.title} <span className="st-muted">× {l.qty}</span>
              </span>
              <span className="nl-money">{rupees(l.line_total_paise)}</span>
            </div>
          ))}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="st-muted" style={{ padding: "7px 0" }}>
                  {k}
                </td>
                <td className="nl-money" style={{ padding: "7px 0", textAlign: "right" }}>
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {order.status !== "paid" && (
          <a
            className="st-btn"
            href={order.short_url}
            target="_blank"
            rel="noreferrer"
            style={{ marginTop: 20 }}
          >
            Pay {rupees(order.amount_paise)} on Razorpay
          </a>
        )}
      </div>

      <p className="st-muted" style={{ fontSize: 14, marginTop: 18 }}>
        <a href="/orders">← All orders</a>
      </p>
    </StoreChrome>
  );
}
