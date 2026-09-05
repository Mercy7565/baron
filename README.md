# Baron

Razorpay Buildathon — Track 1: AI Growth & Agentic Commerce.

Baron is a merchant store an AI buyer can shop end to end, on Razorpay Test
Mode. A payment kernel sits in front of every rupee. Price comes from the
catalog. Coupons come from a ladder the merchant already registered in Razorpay.
The model can talk. It cannot set the bill.

## Why

If an agent buys for a human it will invent a SKU, demand 25% off, or try to pay
₹1. The merchant loses margin or the sale dies. Baron makes the store
traversable by an agent and keeps every money action explainable, bounded, and
gated.

## Live

- https://baron-shop.vercel.app
- https://baron-shop.vercel.app/.well-known/openai-openapi.yaml

## Customer demo

| | |
| --- | --- |
| URL | https://baron-shop.vercel.app |
| User id / email | `aryan` |
| Password | `aryan` |
| Shop code | `BARON-SKIN` |
| Phone number | Any valid Indian number |
| Test card | `5267 3181 8797 5449` |
| OTP | `1234` |
| Expiry | `08/31` |
| CVV | `123` |

1. Log in with the customer id and password above.
2. Enter `BARON-SKIN`. Add a product. Refresh — cart stays.
3. Wallet: save the test card. UI shows last4 only. Agent never sees PAN / CVV /
   OTP.
4. Pay now → Razorpay Payment Link → card + OTP → captured row in Razorpay
   Payments.
5. Assistant: real product name → adds catalog SKU.
6. Assistant: "totally fake unicorn cream" → refuse, no Razorpay call.
7. "25% off" or "make it ₹1" → catalog total wins; coupon is a dashboard offer,
   not the spoken number.
8. Orders: unpaid link can be cancelled. Paid order cannot.

## Merchant demo

| | |
| --- | --- |
| URL | https://baron-shop.vercel.app |
| User id / email | `merchant` |
| Password | `merchant` |

1. Log in with the merchant id and password above.
2. Home tiles = live Razorpay counts.
3. Catalog: change stock or price — survives refresh.
4. Campaigns: create / pause with a spend ceiling. Upsell cannot exceed it.
5. Audit: WHO, ASKED, ALLOWED, WHY, Razorpay id.
6. Kernel cannot mint coupons — only pre-registered offer ids.

## Wallet (today vs next)

**Today:** token stand-in + last4. Agent never gets card data. Payment is hosted
Razorpay Checkout / Payment Links because this account has no S2S card API.

**When Razorpay enables S2S,** the same wallet token is the charge instrument.
Human approves the quote (or a standing mandate), kernel stays green, vault
charges, OTP stays in the vault. "Buy me this" with no second checkout tab. The
quote contract stays.

## Protocols (honest)

Implemented:

- Agent catalog + OpenAPI / ChatGPT Actions
- Quote contract (caller amount discarded)
- ACP-shaped checkout session
- MCP tools
- AP2-shaped mandates + HTTP 402
- Hash-chained audit
- Razorpay Payment Links

## Innovation

The new problem is not "can an agent pay." It is "can a merchant prove what the
agent was allowed to do, and stop it when it wasn't." Baron's kernel is the only
writer of the rupee amount and the coupon id. The agent sends intent. Razorpay
charges the receipt. Spoken ₹1, invented SKUs, and off-ladder discounts never
become a payment.

## Run locally

Node 20+, pnpm.

```bash
cp .env.example .env
pnpm install && pnpm dev
```

Env: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
`APP_BASE_URL`. Optional: `BLOB_READ_WRITE_TOKEN`.

`pnpm verify` runs the typecheck and the full test suite.
