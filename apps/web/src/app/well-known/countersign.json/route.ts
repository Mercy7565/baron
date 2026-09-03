import { MISTAKE_CATALOG } from "@countersign/guard";

import { baseUrl } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /.well-known/countersign.json
 *
 * Our own profile. The point of this document is the honesty of the
 * `not_implemented` block: an outside agent should be able to tell what we
 * actually do before it tries.
 */
export function GET(): Response {
  const base = baseUrl();

  return Response.json(
    {
      name: "CounterSign",
      version: "0.1.0",
      description:
        "A merchant-side control plane. Agents propose money actions; a deterministic kernel decides ALLOW/CLAMP/REJECT/ESCALATE before anything reaches the payment provider.",
      base_url: base,

      what_this_is:
        "Not a checkout protocol and not a wallet. The layer that sits behind whichever one you speak, deciding whether the money may move.",

      related_protocols: {
        "ACP/UCP": "Checkout and discovery. We expose a thin ACP-shaped face and a UCP-shaped profile.",
        AP2: "User mandates. We carry an AP2-shaped intent mandate hash into every order's notes.",
        x402: "Machine settlement. We reuse the 402 status for a missing mandate; there is no crypto rail here.",
        MCP: "Tool transport for agents. Our MCP tools call these same HTTP routes.",
        CounterSign: "The merchant-side gate none of the above provides.",
      },

      endpoints: {
        catalog_feed: `${base}/catalog.json`,
        catalog: `${base}/api/catalog`,
        catalog_search: `${base}/api/catalog/search?q=`,
        catalog_lookup: `${base}/api/catalog/lookup?ids=a,b`,
        propose: `${base}/api/checkout/propose`,
        ucp_profile: `${base}/.well-known/ucp`,
        acp_checkout: `${base}/acp/checkout`,
        acp_products: `${base}/acp/products`,
        mint_demo_mandate: `${base}/api/mandates/demo`,
      },

      money_rules: {
        currency: "INR",
        amounts: "integer paise only",
        discounts: "a closed ladder of merchant-created offers; agents cannot mint a discount",
        audit: "hash-chained append-only log; every decision, including refusals",
      },

      mistake_catalog: MISTAKE_CATALOG,

      mandates: {
        shape: "AP2-shaped local mandates",
        not_ap2_conformant: true,
        chain: "IntentMandate -> CartMandate -> PaymentMandate, each hashing the previous",
        note: "No FIDO attestation, no verifiable credentials, no signature verification, no issuer trust chain. notes.mandate_hash pins intent+cart.",
      },

      payment_required: {
        shape: "x402-shaped",
        status: 402,
        accept: ["ap2-intent-hash"],
        note: "HTTP status and body only. No chain, no USDC, no facilitator, no PAYMENT-SIGNATURE.",
      },

      not_implemented: [
        "ACP delegated_payment",
        "ACP Stripe shared payment tokens (SPT)",
        "ACP webhook signing per spec",
        "Full ACP conformance beyond create/update/complete/cancel/products",
        "UCP full checkout, identity_linking, fulfillment, returns",
        "AP2 verifiable-credential verification",
        "on-chain x402 settlement",
        "NPCI UAP",
        "Full UCP conformance (profile advertises a subset; no negotiation, no session protocol)",
        "AP2 verifiable credentials, FIDO attestation, or any signature verification on mandates",
        "x402 on-chain settlement, USDC, or any crypto rail — 402 is used as a status code only",
        "NPCI UAP",
        "Magic Checkout, line_items, or any Razorpay-hosted cart",
      ],
    },
    { headers: { "cache-control": "no-store" } },
  );
}
