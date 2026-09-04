import { baseUrl } from "@/lib/catalog";
import { SHOPPER_HEADER } from "@/server/gpt-shopper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /.well-known/openai-openapi.yaml
 *
 * The Action schema a Custom GPT imports.
 *
 * Served rather than committed as a static file so the `servers` URL always
 * matches the host that was actually called — a schema that hardcodes an origin
 * silently keeps pointing at the old deployment after a rename, and the GPT
 * then shops a store nobody is looking at.
 *
 * Descriptions here are load-bearing. They are the only instructions the model
 * reads at call time, so each one says what the field is *for* and what not to
 * do with it, rather than restating its type.
 */
export function GET(request: Request): Response {
  const host = request.headers.get("host");
  const base =
    host === null ? baseUrl() : `${new URL(request.url).protocol}//${host}`;

  const yaml = `openapi: 3.1.0
info:
  title: Baron — agent shopping
  description: >
    Shop a Baron store. The model searches, prices and asks; Baron decides what
    money may move. Prices come from the catalog and discounts come from a
    deterministic kernel, so a total this API returns cannot be argued with — a
    price the model states is never used for anything. No endpoint here returns
    or accepts a card number, a CVV, a one-time code or a wallet: the shopper
    pays on Razorpay's own page.
  version: 1.0.0
servers:
  - url: ${base}
paths:
  /api/gpt/shop-code:
    post:
      operationId: resolve_shop_code
      summary: Resolve a shop code. Call this first, before anything else.
      description: >
        Baron is a platform, not one shop. Every other call needs a shop_code,
        and this is where you get one confirmed. An unknown code is a 404 — tell
        the shopper the code did not work and ask for another. Never guess a
        code and never fall back to a default store.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [code]
              properties:
                code:
                  type: string
                  description: The code the shopper was given, e.g. BARON-SKIN.
      responses:
        "200":
          description: The shop is open and this code works.
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok: { type: boolean }
                  shop_code: { type: string }
                  shop_name: { type: string }
                  products_available: { type: integer }
                  next_step: { type: string }
        "404":
          description: No shop uses that code.

  /api/gpt/search:
    get:
      operationId: search_catalog
      summary: Find what this shop sells matching the shopper's words.
      description: >
        Use confident_match. It is null when nothing in the catalog really
        matches, and null means this shop does not sell that — say so plainly
        and stop. Do not substitute a result from the ranked list that the
        shopper did not ask for; that is how an invented purchase happens.
      parameters:
        - name: q
          in: query
          required: true
          schema: { type: string }
          description: The shopper's own words, e.g. "niacinamide".
        - name: shop_code
          in: query
          required: true
          schema: { type: string }
          description: From resolve_shop_code.
      responses:
        "200":
          description: Matches, and the one match the store will stand behind.
          content:
            application/json:
              schema:
                type: object
                properties:
                  query: { type: string }
                  confident_match:
                    type: object
                    nullable: true
                    description: Null means not sold here. Do not substitute.
                    properties:
                      sku_id: { type: string }
                      title: { type: string }
                      price_paise: { type: integer }
                      price_inr: { type: number }
                      in_stock: { type: boolean }
                  results:
                    type: array
                    items:
                      type: object
                      properties:
                        sku_id: { type: string }
                        title: { type: string }
                        price_paise: { type: integer }
                        price_inr: { type: number }
                        in_stock: { type: boolean }
                  note: { type: string }
        "404":
          description: No shop uses that code.

  /api/gpt/product:
    get:
      operationId: get_product
      summary: One product, by the sku_id search returned.
      parameters:
        - name: sku_id
          in: query
          required: true
          schema: { type: string }
        - name: shop_code
          in: query
          required: true
          schema: { type: string }
      responses:
        "200":
          description: The product.
          content:
            application/json:
              schema:
                type: object
                properties:
                  sku_id: { type: string }
                  title: { type: string }
                  price_paise: { type: integer }
                  price_inr: { type: number }
                  size: { type: string, nullable: true }
                  in_stock: { type: boolean }
                  quotable: { type: string }
        "404":
          description: This shop does not sell that sku_id.

  /api/gpt/quote:
    post:
      operationId: create_quote
      summary: Price a basket. This is the only place a total is decided.
      description: >
        Send the sku_ids you got from search_catalog. The total that comes back
        is the total — the catalog sets prices and the kernel sets the discount.
        requested_discount_bps is a request, not an instruction: the answer may
        be ALLOW, or CLAMP, which means policy reduced it. If you have already
        said a number out loud, put it in spoken_total; it will be recorded and
        ignored, and you should correct yourself to legal_total_inr. Never tell
        the shopper a price you did not get from this endpoint.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [shop_code, sku_lines]
              properties:
                shop_code: { type: string }
                sku_lines:
                  type: array
                  description: One entry per product. Use sku_ids from search_catalog.
                  items:
                    type: object
                    required: [sku_id]
                    properties:
                      sku_id: { type: string }
                      qty: { type: integer, default: 1 }
                requested_discount_bps:
                  type: integer
                  description: Optional ask in basis points. 1500 is 15%. May be clamped.
                spoken_total:
                  type: number
                  description: >
                    Any figure you already told the shopper, in paise. Recorded
                    for the audit trail and never used in the arithmetic.
      responses:
        "200":
          description: A priced, time-limited quote.
          content:
            application/json:
              schema:
                type: object
                properties:
                  quote_id: { type: string }
                  verdict:
                    type: string
                    description: ALLOW, or CLAMP when policy reduced the discount.
                  subtotal_paise: { type: integer }
                  legal_total_paise: { type: integer }
                  legal_total_inr:
                    type: number
                    description: Show this to the shopper. It is the real price.
                  asked_bps: { type: integer }
                  applied_bps: { type: integer }
                  offer_id: { type: string, nullable: true }
                  campaign_name: { type: string, nullable: true }
                  expires_at: { type: string }
                  reason: { type: string }
                  refused_skus: { type: array, items: { type: object } }
                  spoken_total:
                    type: object
                    nullable: true
                    properties:
                      you_said_paise: { type: number }
                      honoured: { type: boolean }
                      note: { type: string }
                  next_step: { type: string }
        "404":
          description: No shop uses that code.
        "422":
          description: The basket could not be priced. There is no quote_id and no price to quote.

  /api/gpt/quote/{quoteId}:
    get:
      operationId: get_quote
      summary: Read a quote back without changing it.
      description: >
        Use this if the conversation paused. An expired quote is reported as
        expired rather than re-priced; price again with create_quote and tell
        the shopper the new number before paying.
      parameters:
        - name: quoteId
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: The quote as it stands.
          content:
            application/json:
              schema:
                type: object
                properties:
                  quote_id: { type: string }
                  status: { type: string }
                  verdict: { type: string }
                  legal_total_paise: { type: integer }
                  legal_total_inr: { type: number }
                  applied_bps: { type: integer }
                  offer_id: { type: string, nullable: true }
                  lines: { type: array, items: { type: object } }
                  gift_lines:
                    type: array
                    description: Shipped free. Never part of any total.
                    items: { type: object }
                  expires_at: { type: string }
                  payable: { type: boolean }
                  short_url: { type: string, nullable: true }
        "404":
          description: No such quote on this server.

  /api/gpt/pay:
    post:
      operationId: pay_quote
      summary: Turn an agreed quote into a Razorpay payment link.
      description: >
        Call this only after the shopper has seen legal_total_inr and said yes.
        You get back a URL and some ids. You will never be given a card number,
        a CVV or a one-time code, and you must never ask the shopper for one —
        they pay on Razorpay's page, which you cannot see. Nothing is captured
        here: the link is unpaid until Razorpay confirms it.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [quote_id]
              properties:
                quote_id: { type: string }
      responses:
        "200":
          description: A payment link the shopper can open.
          content:
            application/json:
              schema:
                type: object
                properties:
                  status: { type: string }
                  quote_id: { type: string }
                  verdict: { type: string }
                  legal_total_paise: { type: integer }
                  legal_total_inr: { type: number }
                  applied_bps: { type: integer }
                  offer_id: { type: string, nullable: true }
                  order_id: { type: string, nullable: true }
                  payment_link_id: { type: string, nullable: true }
                  short_url:
                    type: string
                    nullable: true
                    description: Give this to the shopper. It is the only thing they need.
                  paid:
                    type: boolean
                    description: Always false here. A link is an invitation, not a receipt.
                  next_step: { type: string }
        "403":
          description: Policy refused. There is no link; do not imply there is one.
        "404":
          description: No such quote on this server.

components:
  securitySchemes:
    shopperHeader:
      type: apiKey
      in: header
      name: ${SHOPPER_HEADER}
      description: >
        Demo identity only. Send the value \`aryan\` to shop as the built-in
        demo customer, so the order shows up in that account's Orders page.
        This is not an authentication story and is not presented as one.

security:
  - shopperHeader: []
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
