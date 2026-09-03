import { ConsoleChrome } from "@/components/ConsoleChrome";

export const dynamic = "force-dynamic";

const IMPLEMENTED: Array<[string, string]> = [
  ["MCP", "Six stdio tools; each one an HTTP call to these routes."],
  ["ACP-shaped checkout", "create / read / update / complete / cancel + products. Shaped, not conformant."],
  ["AP2-shaped mandates", "Local hashed intent to cart to payment, carried in notes.mandate_hash."],
  ["HTTP 402", "A missing mandate answers 402 with accept: ap2-intent-hash."],
  [".well-known", "countersign.json and a UCP-shaped capability profile."],
  ["Razorpay Payment Links", "Real links, created on every agent purchase. The buyer completes them."],
];

const NOT_IMPLEMENTED: Array<[string, string]> = [
  ["NPCI UAP", "No UAP integration exists in this build."],
  ["S2S card capture (payments/create/json)", "Returns 404 on this account. We do not fake a Captured payment."],
  ["Official ChatGPT Shopping", "No partnership and no listing. Just an HTTP API a custom Action can call."],
  ["FIDO / WebAuthn attestation", "Mandates are hashed, not attested."],
  ["AP2 verifiable credentials", "No credential issuance or verification."],
  ["on-chain x402", "402 is a status code here. No chain, no token, no facilitator."],
];

export default function MerchantProtocols() {
  return (
    <ConsoleChrome current="/merchant/protocols">
      <h1>Protocols</h1>
      <p className="mc-sub">
        What this merchant actually speaks, and what it deliberately does not. The second table is
        the more important one.
      </p>

      <div className="mc-panel" style={{ marginBottom: 12 }}>
        <h2>Implemented faces</h2>
        <table className="mc-table">
          <thead>
            <tr>
              <th style={{ width: 260 }}>Face</th>
              <th>What that means here</th>
            </tr>
          </thead>
          <tbody>
            {IMPLEMENTED.map(([k, v]) => (
              <tr key={k}>
                <td>
                  <span className="mc-pill" data-tone="live">
                    implemented
                  </span>{" "}
                  {k}
                </td>
                <td style={{ color: "var(--muted)" }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mc-panel">
        <h2>Not implemented</h2>
        <table className="mc-table">
          <thead>
            <tr>
              <th style={{ width: 260 }}>Face</th>
              <th>Why not</th>
            </tr>
          </thead>
          <tbody>
            {NOT_IMPLEMENTED.map(([k, v]) => (
              <tr key={k}>
                <td>
                  <span className="mc-pill" data-tone="blocked">
                    not implemented
                  </span>{" "}
                  {k}
                </td>
                <td style={{ color: "var(--muted)" }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </ConsoleChrome>
  );
}
