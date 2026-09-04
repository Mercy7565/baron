import { baseUrl } from "@/lib/catalog";
import { SHOPPER_HEADER } from "@/server/gpt-shopper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /.well-known/openai-openapi.yaml
 *
 * The Action schema a Custom GPT imports.
 *
 * Written to ChatGPT's importer, which is stricter than the spec in three ways
 * that all failed silently or late:
 *
 *   - it wants OpenAPI 3.0.x, not 3.1;
 *   - `components.schemas` has to be a real object, so responses are $ref'd
 *     rather than inlined;
 *   - every description is capped at 300 characters, and an over-long one
 *     rejects the whole import rather than that one field.
 *
 * So descriptions here are single short sentences, held under 280 by a test.
 * Anything that wants a paragraph belongs in docs/CUSTOM_GPT.md or on
 * /connect-ai, not in a field the importer measures.
 *
 * Served rather than committed so `servers.url` follows the deployment: a
 * hardcoded origin keeps pointing at the old host after a rename, and the GPT
 * then shops a store nobody is watching.
 */
export function GET(request: Request): Response {
  const configured = baseUrl();
  const host = request.headers.get("host");
  // APP_BASE_URL is authoritative; the calling host is the fallback for a
  // preview deployment that has none.
  const base =
    configured.includes("localhost") && host !== null
      ? `${new URL(request.url).protocol}//${host}`
      : configured;

  const yaml = `openapi: 3.0.3
info:
  title: Baron agent shopping
  description: Shop a Baron store. The catalog sets prices and a policy kernel sets discounts, so a price this API returns cannot be argued with. No endpoint returns or accepts card details.
  version: 1.0.0
servers:
  - url: ${base}
paths:
  /api/gpt/shop-code:
    post:
      operationId: resolve_shop_code
      summary: Resolve a shop code
      description: Call this first in every conversation. An unknown code returns 404; ask the shopper for another and never guess one. The demo store is BARON-SKIN.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ShopCodeRequest'
      responses:
        '200':
          description: The code is valid and the shop is open.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ShopInfo'
        '404':
          description: No shop uses that code.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
  /api/gpt/search:
    get:
      operationId: search_catalog
      summary: Search this shop
      description: Use confident_match. When it is null the shop does not sell that; say so and stop. Never substitute a product from results that the shopper did not ask for.
      parameters:
        - name: q
          in: query
          required: true
          description: The shopper's own words, such as niacinamide.
          schema:
            type: string
        - name: shop_code
          in: query
          required: true
          description: The code returned by resolve_shop_code.
          schema:
            type: string
      responses:
        '200':
          description: Matching products.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SearchResult'
        '404':
          description: No shop uses that code.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
  /api/gpt/product:
    get:
      operationId: get_product
      summary: Get one product
      description: Look up a single product using a sku_id returned by search_catalog.
      parameters:
        - name: sku_id
          in: query
          required: true
          description: A sku_id from a search result.
          schema:
            type: string
        - name: shop_code
          in: query
          required: true
          description: The code returned by resolve_shop_code.
          schema:
            type: string
      responses:
        '200':
          description: The product.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProductDetail'
        '404':
          description: This shop does not sell that sku_id.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
  /api/gpt/quote:
    post:
      operationId: create_quote
      summary: Price a basket
      description: The only place a total comes from. Show the shopper legal_total_inr and nothing else as the price. A CLAMP verdict means the store reduced the discount; only applied_bps may be repeated.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/QuoteRequest'
      responses:
        '200':
          description: A priced, time-limited quote.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/QuoteCreated'
        '404':
          description: No shop uses that code.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '422':
          description: The basket could not be priced, so there is no quote and no price to give.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
  /api/gpt/quote/{quoteId}:
    get:
      operationId: get_quote
      summary: Read a quote
      description: Check whether a price still stands after a pause. An expired quote is reported, not re-priced; quote again and tell the shopper the new total.
      parameters:
        - name: quoteId
          in: path
          required: true
          description: The quote_id from create_quote.
          schema:
            type: string
      responses:
        '200':
          description: The quote as it stands.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/QuoteDetail'
        '404':
          description: No such quote on this server.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
  /api/gpt/pay:
    post:
      operationId: pay_quote
      summary: Create a payment link
      description: Call only after the shopper has seen the total and agreed. Returns a link they open themselves. Nothing is charged here and paid is always false. Never ask for a card number, CVV or one-time code.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PayRequest'
      responses:
        '200':
          description: A payment link the shopper can open.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaymentLink'
        '403':
          description: Policy refused, so no link exists.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '404':
          description: No such quote on this server.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
    Error:
      type: object
      properties:
        error:
          type: string
        message:
          type: string
    ShopCodeRequest:
      type: object
      required:
        - code
      properties:
        code:
          type: string
          description: The code the shopper was given, such as BARON-SKIN.
    ShopInfo:
      type: object
      properties:
        ok:
          type: boolean
        shop_code:
          type: string
        shop_name:
          type: string
        currency:
          type: string
        products_available:
          type: integer
        next_step:
          type: string
    ProductSummary:
      type: object
      properties:
        sku_id:
          type: string
        title:
          type: string
        price_paise:
          type: integer
        price_inr:
          type: number
        in_stock:
          type: boolean
    ProductDetail:
      type: object
      properties:
        shop_code:
          type: string
        sku_id:
          type: string
        title:
          type: string
        price_paise:
          type: integer
        price_inr:
          type: number
        size:
          type: string
          nullable: true
        category:
          type: array
          items:
            type: string
        in_stock:
          type: boolean
        quotable:
          type: string
    SearchResult:
      type: object
      properties:
        shop_code:
          type: string
        query:
          type: string
        confident_match:
          allOf:
            - $ref: '#/components/schemas/ProductSummary'
          nullable: true
          description: Null means this shop does not sell that. Do not substitute.
        results:
          type: array
          items:
            $ref: '#/components/schemas/ProductSummary'
        note:
          type: string
    SkuLine:
      type: object
      required:
        - sku_id
      properties:
        sku_id:
          type: string
        qty:
          type: integer
          default: 1
    QuoteRequest:
      type: object
      required:
        - shop_code
        - sku_lines
      properties:
        shop_code:
          type: string
        sku_lines:
          type: array
          description: One entry per product, using sku_ids from search_catalog.
          items:
            $ref: '#/components/schemas/SkuLine'
        requested_discount_bps:
          type: integer
          description: An optional ask in basis points, where 1500 is 15 percent. It may be clamped.
        spoken_total:
          type: number
          description: Any figure already said to the shopper, in paise. Recorded and ignored.
    SpokenTotal:
      type: object
      properties:
        you_said_paise:
          type: number
        honoured:
          type: boolean
        note:
          type: string
    RefusedSku:
      type: object
      properties:
        sku_id:
          type: string
        code:
          type: string
        message:
          type: string
    QuoteCreated:
      type: object
      properties:
        quote_id:
          type: string
        shop_code:
          type: string
        verdict:
          type: string
          description: ALLOW, or CLAMP when the store reduced the discount.
        subtotal_paise:
          type: integer
        legal_total_paise:
          type: integer
        legal_total_inr:
          type: number
          description: The real price. Show this and no other number.
        asked_bps:
          type: integer
        applied_bps:
          type: integer
        offer_id:
          type: string
          nullable: true
        campaign_name:
          type: string
          nullable: true
        expires_at:
          type: string
        reason:
          type: string
        refused_skus:
          type: array
          items:
            $ref: '#/components/schemas/RefusedSku'
        spoken_total:
          allOf:
            - $ref: '#/components/schemas/SpokenTotal'
          nullable: true
        next_step:
          type: string
    QuoteLine:
      type: object
      properties:
        sku_id:
          type: string
        title:
          type: string
        qty:
          type: integer
        line_total_paise:
          type: integer
    GiftLine:
      type: object
      properties:
        sku_id:
          type: string
        title:
          type: string
        qty:
          type: integer
        free:
          type: boolean
    QuoteDetail:
      type: object
      properties:
        quote_id:
          type: string
        status:
          type: string
        verdict:
          type: string
        subtotal_paise:
          type: integer
        legal_total_paise:
          type: integer
        legal_total_inr:
          type: number
        asked_bps:
          type: integer
        applied_bps:
          type: integer
        offer_id:
          type: string
          nullable: true
        lines:
          type: array
          items:
            $ref: '#/components/schemas/QuoteLine'
        gift_lines:
          type: array
          description: Shipped free and never part of any total.
          items:
            $ref: '#/components/schemas/GiftLine'
        expires_at:
          type: string
        payable:
          type: boolean
        payment_link_id:
          type: string
          nullable: true
        short_url:
          type: string
          nullable: true
    PayRequest:
      type: object
      required:
        - quote_id
      properties:
        quote_id:
          type: string
    PaymentLink:
      type: object
      properties:
        status:
          type: string
        quote_id:
          type: string
        verdict:
          type: string
        legal_total_paise:
          type: integer
        legal_total_inr:
          type: number
        applied_bps:
          type: integer
        offer_id:
          type: string
          nullable: true
        order_id:
          type: string
          nullable: true
        payment_link_id:
          type: string
          nullable: true
        short_url:
          type: string
          nullable: true
          description: Give this to the shopper. It is all they need.
        idempotent_replay:
          type: boolean
        paid:
          type: boolean
          description: Always false here. A link is an invitation, not a receipt.
        next_step:
          type: string
  securitySchemes:
    shopperHeader:
      type: apiKey
      in: header
      name: ${SHOPPER_HEADER}
      description: Demo identity only. Send the value aryan to shop as the built-in demo customer.
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
