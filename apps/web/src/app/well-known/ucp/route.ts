import { baseUrl } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /.well-known/ucp
 *
 * A UCP-shaped capability profile. This declares the three things we genuinely
 * serve and explicitly disclaims the rest — it is a discovery aid, not a
 * conformance claim.
 */
export function GET(): Response {
  const base = baseUrl();

  return Response.json(
    {
      profile: "ucp-shaped",
      conformance: "partial — subset only, see unsupported",
      vendor: "CounterSign",
      base_url: base,

      capabilities: {
        "catalog.search": {
          method: "GET",
          endpoint: `${base}/api/catalog/search`,
          params: { q: "string", limit: "int, default 10, max 50" },
        },
        "catalog.lookup": {
          method: "GET",
          endpoint: `${base}/api/catalog/lookup`,
          params: { ids: "comma-separated sku ids" },
        },
        checkout: {
          method: "POST",
          endpoint: `${base}/api/checkout/propose`,
          note: "Proposal, not a commit. Returns a kernel verdict; only ALLOW and CLAMP create an order.",
          requires: "mandate_hash — absent or expired is answered 402",
        },
      },

      unsupported: [
        "full UCP checkout",
        "identity_linking",
        "fulfillment",
        "returns",
        "NPCI UAP",
        "on-chain x402",
        "AP2 verifiable-credential verification",
        "session negotiation",
        "cart mutation over UCP",
        "fulfilment and shipping",
        "returns and refunds",
        "any UCP authentication scheme",
      ],
    },
    { headers: { "cache-control": "no-store" } },
  );
}
