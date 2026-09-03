import { DEV_POLICY } from "@/lib/policy";

export const dynamic = "force-dynamic";

export default function PolicyPage() {
  return (
    <main>
      <h1>Policy {DEV_POLICY.policy_version}</h1>
      <p className="cs-muted">
        The bounds every proposal is measured against. An agent cannot edit this page and cannot
        argue with it.
      </p>

      <h2>Limits</h2>
      <table className="cs-table" style={{ maxWidth: 560 }}>
        <tbody>
          <tr>
            <th>max_order_paise</th>
            <td>
              {DEV_POLICY.max_order_paise} (₹{DEV_POLICY.max_order_paise / 100}) — above this,
              REJECT
            </td>
          </tr>
          <tr>
            <th>escalate_above_paise</th>
            <td>
              {DEV_POLICY.escalate_above_paise ?? "—"} — at or above this a human decides, no offer
              is attached
            </td>
          </tr>
          <tr>
            <th>margin_floor_bps</th>
            <td>{DEV_POLICY.margin_floor_bps} — post-discount margin may never fall below this</td>
          </tr>
          <tr>
            <th>blocked_product_ids</th>
            <td>{DEV_POLICY.blocked_product_ids.join(", ") || "—"}</td>
          </tr>
        </tbody>
      </table>

      <h2>The ladder</h2>
      <p className="cs-muted">
        A closed set of merchant-created offers. The kernel can only ever return one of these ids —
        it has no other source, so it cannot invent a discount.
      </p>
      <table className="cs-table" style={{ maxWidth: 560 }}>
        <thead>
          <tr>
            <th>discount</th>
            <th>offer_id</th>
          </tr>
        </thead>
        <tbody>
          {DEV_POLICY.ladder.map((r) => (
            <tr key={r.offer_id}>
              <td>{r.discount_bps / 100}%</td>
              <td>{r.offer_id}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>How a discount is chosen</h2>
      <ol>
        <li>Take the largest coupon at or below what was requested.</li>
        <li>Skip any coupon whose minimum cart this basket does not reach.</li>
        <li>Skip any coupon that would push margin under the floor.</li>
        <li>If nothing qualifies, apply no discount at all.</li>
        <li>Never round up. Never sum campaigns. Never accept an offer id from outside the ladder.</li>
      </ol>
    </main>
  );
}
