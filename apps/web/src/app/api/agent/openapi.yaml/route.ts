import { baseUrl } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/agent/openapi.yaml
 *
 * The Action schema a Custom GPT imports. Served rather than committed as a
 * static file so the server URL always matches wherever this is deployed.
 */
export function GET(request: Request): Response {
  // Prefer the host actually being called, so an imported schema points back at
  // the deployment the GPT reached rather than at a hardcoded origin.
  const base = request.headers.get("host")
    ? `${new URL(request.url).protocol}//${request.headers.get("host")}`
    : baseUrl();

  const yaml = `openapi: 3.1.0
info:
  title: Agent Shopping
  description: >
    Shop this store in two rounds. Round 1 sends the shopper's intent.
    If an upsell would unlock more legal discount the API asks for a yes or no;
    round 2 sends that answer and returns a Razorpay Payment Link. The store
    never returns card numbers or one-time codes, and never asks for them.
  version: 0.1.0
servers:
  - url: ${base}
paths:
  /api/agent/shop:
    post:
      operationId: shopBaron
      summary: Shop this store. Round 1 sends intent_text; round 2 sends resume_token and accept_upsell.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                intent_text:
                  type: string
                  description: Round 1 only. What the shopper wants, e.g. "buy me niacinamide".
                resume_token:
                  type: string
                  description: Round 2 only. The token returned by round 1.
                accept_upsell:
                  type: boolean
                  description: Round 2 only. The shopper's yes or no to the suggestion.
      responses:
        "200":
          description: A decision request, a payment link, a refusal, or not found.
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    enum: [need_upsell_decision, ready_to_pay, not_found, refused]
                  resume_token:
                    type: string
                    description: Present when status is need_upsell_decision. Pass it back in round 2.
                  found:
                    type: object
                    properties:
                      sku_id: { type: string }
                      title: { type: string }
                      price_paise: { type: integer }
                  suggestion:
                    type: object
                    description: Present when status is need_upsell_decision. Ask the shopper about this, yes or no.
                    properties:
                      sku_id: { type: string }
                      title: { type: string }
                      price_paise: { type: integer }
                      extra_bps: { type: integer }
                      message: { type: string }
                  short_url:
                    type: string
                    nullable: true
                    description: The Razorpay payment link. Show only this to the shopper.
                  payment_link_id:
                    type: string
                    nullable: true
                  legal_total_paise:
                    type: integer
                    description: Amount in paise. Divide by 100 for rupees.
                  verdict:
                    type: string
                    description: ALLOW or CLAMP. CLAMP means policy reduced the discount.
                  applied_bps:
                    type: integer
                    description: Discount actually granted, in basis points.
                  message:
                    type: string
                    description: Present when status is not_found.
                  reason:
                    type: string
                    description: Present when status is refused.
        "410":
          description: The resume_token expired. Start again at round 1.
`;

  return new Response(yaml, {
    status: 200,
    headers: {
      "content-type": "application/yaml; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}
