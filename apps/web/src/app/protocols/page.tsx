export const dynamic = "force-dynamic";

interface Face {
  name: string;
  claim: string;
  solves: string;
  implemented: Array<{ label: string; href?: string }>;
  refused: string[];
}

/**
 * One section per protocol, each stating what we actually serve and what we
 * refuse by name. The refusals matter as much as the endpoints: an outside
 * agent should learn our limits here rather than by failing against them.
 */
const FACES: Face[] = [
  {
    name: "ACP-shaped checkout",
    claim: "Shaped, not conformant.",
    solves: "How an outside agent drives a purchase: create a session, adjust it, complete it.",
    implemented: [
      { label: "POST /acp/checkout — create (402 without a mandate)" },
      { label: "GET /acp/checkout/:id — read" },
      { label: "POST /acp/checkout/:id — update items" },
      { label: "POST /acp/checkout/:id/complete — runs the same kernel + one Razorpay order" },
      { label: "POST /acp/checkout/:id/cancel — terminal; a cancelled session cannot complete" },
      { label: "GET /acp/products", href: "/acp/products" },
    ],
    refused: [
      "delegated_payment",
      "Stripe shared payment tokens (SPT)",
      "ACP webhook signing per spec",
      "session negotiation, fulfilment, returns",
    ],
  },
  {
    name: "AP2-shaped local mandates",
    claim:
      "AP2-shaped local mandates. Not AP2. No FIDO Alliance conformance is claimed or implied.",
    solves: "Bounding what an agent may spend on a human's behalf, and pinning it to an order.",
    implemented: [
      { label: "IntentMandate { max_amount_paise, max_discount_bps, sku_allowlist, exp, sub }" },
      { label: "CartMandate { items, amount_paise, intent_hash }" },
      { label: "PaymentMandate { order_id, amount_paise, cart_hash }" },
      { label: "notes.mandate_hash pins intent + cart on every order" },
      { label: "POST /api/mandates/demo — dev mint so a human can pay" },
    ],
    refused: [
      "verifiable credentials",
      "FIDO / WebAuthn attestation",
      "signature verification on mandates",
      "issuer trust chains",
    ],
  },
  {
    name: "x402-shaped payment required",
    claim: "An HTTP status and a body. There is no rail behind it.",
    solves: "Telling a machine caller, in-band, that it needs authorisation before money moves.",
    implemented: [
      { label: "402 from /api/checkout/propose and /acp/checkout without a valid mandate" },
      { label: 'body { error: "mandate_required", accept: ["ap2-intent-hash"], continue_url }' },
      { label: 'header payment-required: ap2-intent-hash realm="countersign"' },
      { label: "retry with mandate_hash does not 402" },
    ],
    refused: [
      "on-chain settlement",
      "USDC or any token",
      "facilitator services",
      "PAYMENT-SIGNATURE crypto verification",
    ],
  },
  {
    name: "MCP",
    claim: "Transport only. No privileged path to money.",
    solves: "Letting an agent in Claude Desktop use the store as tools.",
    implemented: [
      { label: "search_catalog, lookup_skus, get_cart, list_campaigns" },
      { label: "create_intent_mandate, propose_money_action" },
      { label: "every tool is an HTTP call to the routes on this site" },
      { label: "the package never imports the payment provider — asserted by a test" },
    ],
    refused: ["resources", "prompts", "sampling", "any direct provider access"],
  },
  {
    name: "UCP profile",
    claim: "A discovery aid advertising a subset, not a conformance claim.",
    solves: "Letting a bot find our capabilities without scraping.",
    implemented: [
      { label: "GET /.well-known/ucp", href: "/.well-known/ucp" },
      { label: "GET /.well-known/countersign.json", href: "/.well-known/countersign.json" },
      { label: "catalog.search, catalog.lookup, checkout (our subset)" },
    ],
    refused: [
      "full UCP checkout",
      "identity_linking",
      "fulfillment",
      "returns",
      "NPCI UAP",
    ],
  },
  {
    name: "CounterSign",
    claim: "The layer the other four leave out.",
    solves:
      "The merchant-side gate. Every proposed money action is bounded, explained, gated and audited before it reaches the payment provider — and an agent cannot go around it.",
    implemented: [
      { label: "POST /api/checkout/propose — one kernel, one createOrder call site" },
      { label: "GET /policy — the bounds", href: "/policy" },
      { label: "GET /failures — the mistake catalog", href: "/failures" },
      { label: "GET /audit — hash-chained decisions", href: "/audit" },
    ],
    refused: ["nothing here is optional; this is the product"],
  },
];

export default function ProtocolsPage() {
  return (
    <main>
      <p className="nl-kicker">Honest surface</p>
      <h1 style={{ fontWeight: 650 }}>Protocols</h1>

      <div className="cs-scroll-x" style={{ margin: "var(--space-3) 0" }}>
        <table className="cs-table">
          <thead>
            <tr>
              <th>Face</th>
              <th>Status</th>
              <th>What that means here</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>MCP</td>
              <td className="cs-ok">implemented</td>
              <td>Six stdio tools; every one is an HTTP call to these routes.</td>
            </tr>
            <tr>
              <td>ACP-shaped</td>
              <td className="cs-ok">implemented</td>
              <td>create / read / update / complete / cancel + products. Not conformant.</td>
            </tr>
            <tr>
              <td>AP2-shaped</td>
              <td className="cs-ok">implemented</td>
              <td>Local hashed intent → cart → payment chain in notes.mandate_hash.</td>
            </tr>
            <tr>
              <td>HTTP 402</td>
              <td className="cs-ok">implemented</td>
              <td>Missing mandate answers 402 with accept: ap2-intent-hash.</td>
            </tr>
            <tr>
              <td>.well-known</td>
              <td className="cs-ok">implemented</td>
              <td>countersign.json and a UCP-shaped capability profile.</td>
            </tr>
            <tr>
              <td>Payment Links</td>
              <td className="cs-ok">implemented</td>
              <td>Real Razorpay links. The buyer completes them.</td>
            </tr>
            <tr>
              <td>NPCI UAP</td>
              <td className="cs-danger">not implemented</td>
              <td>No UAP integration exists in this build.</td>
            </tr>
            <tr>
              <td>FIDO / WebAuthn</td>
              <td className="cs-danger">not implemented</td>
              <td>Mandates are hashed, not attested. No AP2 credential verification.</td>
            </tr>
            <tr>
              <td>on-chain x402</td>
              <td className="cs-danger">not implemented</td>
              <td>402 is a status code here. No chain, no token, no facilitator.</td>
            </tr>
            <tr>
              <td>Custom GPT Actions</td>
              <td className="cs-ok">implemented</td>
              <td>
                Six actions at <code>/.well-known/openai-openapi.yaml</code>. A GPT resolves a shop
                code, searches, quotes and gets a Payment Link — and never receives a card number,
                a CVV, a one-time code or a wallet.
              </td>
            </tr>
            <tr>
              <td>Official ChatGPT Shopping</td>
              <td className="cs-danger">not implemented</td>
              <td>
                No partnership, no listing, no merchant feed. The line above is a Custom GPT
                importing an OpenAPI schema, which is a different thing wearing a similar name.
              </td>
            </tr>
            <tr>
              <td>S2S card capture</td>
              <td className="cs-danger">not enabled</td>
              <td>payments/create/json returns 404 on this account. We do not fake it.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        The unsolved layer is not <em>how does an agent pay</em>. ACP and UCP handle checkout and
        discovery, AP2 handles user mandates, x402 handles machine settlement. None of them is a
        merchant-side control plane that an agent cannot bypass. That is what this is.
      </p>
      <p className="cs-muted">
        Every face below is deliberately thin. Where we have not implemented something, it is named
        rather than glossed — in this page and in{" "}
        <a href="/.well-known/countersign.json">the profile JSON</a>.
      </p>

      {FACES.map((f) => (
        <section key={f.name} style={{ marginTop: "var(--space-3)" }}>
          <h2>{f.name}</h2>
          <p>
            <strong>{f.claim}</strong>
          </p>
          <p className="cs-muted">{f.solves}</p>

          <h3 style={{ fontSize: 14 }}>Implemented</h3>
          <ul>
            {f.implemented.map((i) => (
              <li key={i.label} className="mono" style={{ fontSize: 13 }}>
                {i.href !== undefined ? <a href={i.href}>{i.label}</a> : i.label}
              </li>
            ))}
          </ul>

          <h3 style={{ fontSize: 14 }}>Refused</h3>
          <ul>
            {f.refused.map((r) => (
              <li key={r} className="cs-muted mono" style={{ fontSize: 13 }}>
                {r}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
