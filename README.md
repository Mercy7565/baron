# Baron

**Baron is a merchant-side control plane for agent commerce: an AI can shop, negotiate and check out on this store, and a deterministic kernel decides what money may actually move before anything reaches Razorpay.**

> Tired of tapping checkout? Say it. We still won't let the model set the price.
> Agents welcome. Unbounded discounts are not.

Razorpay AI Buildathon — Track 01. Everything below is on Razorpay **Test mode**.

---

## Quick start

```bash
pnpm install
cp .env.example .env      # fill in your Razorpay test keys
pnpm dev                  # http://localhost:3000
```

| | |
| --- | --- |
| **Live demo** | https://baron-shop.vercel.app |
| **Shop code** | `BARON-SKIN` — a shopper enters this to see the catalog |
| **Sign in** | `merchant` / `merchant` for the console, `aryan` / `aryan` to shop |
| **Test card** | `5267 3181 8797 5449`, any future expiry, any CVV |
| **Custom GPT schema** | https://baron-shop.vercel.app/.well-known/openai-openapi.yaml |
| **Webhook** | `POST /api/webhooks/razorpay`, signed with `RAZORPAY_WEBHOOK_SECRET` |

`pnpm verify` runs the typecheck and the full test suite.

**Storage.** Campaigns, catalog edits and the margin floor are shared state, so
they need somewhere durable. A laptop uses `.data/`. A deployment needs a Vercel
Blob store connected to the project, which injects `BLOB_READ_WRITE_TOKEN`;
without one the merchant console says on screen that its edits are not being
saved rather than losing them quietly. Everything else either lives in the
shopper's own signed cookie (basket, wallet reference, shop code) or is
reconstructed from the Razorpay account (orders, payments, decisions).

---

## Track 01, both halves

**Grow revenue.** A campaign console with real spend ceilings, an orchestrator
that shows which campaign fires and why, and a ranked upsell that only ever
suggests SKUs already linked in the catalog — scored by how much *legal*
discount each would unlock. Ask for 15% on a basket that supports 2%, and you
get 2%.

**Sellable to any AI.** A **Custom GPT** shops a Baron store through six
Actions — resolve a shop code, search, get a product, quote, re-read a quote,
and turn it into a real Razorpay **Payment Link**. An outside agent needs no
SDK, no cookie and no account. The OpenAPI schema is served at
`/.well-known/openai-openapi.yaml`; the older two-round endpoint
`POST /api/agent/shop` still works and keeps its schema at
`/api/agent/openapi.yaml`.

The model never receives a card number, a CVV, a one-time code, a Razorpay
secret or the contents of a wallet — not because a filter strips them, but
because no endpoint on that surface ever puts one in a response. A price the
model states is recorded as `spoken_total` and ignored; the catalog and the
kernel decide what is owed.

The gap neither half closes on its own: ACP and UCP handle checkout and
discovery, AP2 handles user mandates, x402 handles machine settlement. **None of
them is a merchant-side gate an agent cannot talk its way past.** That is this.

---

## What is REAL on Razorpay Test

| Thing | Evidence |
| --- | --- |
| **Orders** created via the API | one `createOrder` call site, real `order_…` ids |
| **Offers attach** to those orders | `offers: ["offer_…"] + force_offer: true`, verified against a live order's `offers` array |
| **Payment Links** created per purchase | real `plink_…` and `rzp.io` short URLs, visible in Dashboard → Payment Links |
| **`/gate` reaches Captured** | Razorpay Checkout.js, human types the test card |
| **Audit chain** | hash-chained JSONL; tamper one row and `/merchant/audit` says `CHAIN BROKEN AT seq=N` |
| **Kernel** | 16 tests; zero imports, zero I/O, same inputs → same verdict forever |
| **Campaign budgets burn** | issuing a link debits that campaign's `spent_paise`, clamped at its ceiling — the console shows real burn, not a seeded number |
| **Health** | `GET /api/health` → `{ ok: true, settlement: "razorpay_payment_link" }` |

## What is honestly NOT

| Not implemented | Why |
| --- | --- |
| **Server-to-server card charge** | `POST /v1/payments/create/json` returns 404 on this account. There is no headless card API here, so the buyer completes the Payment Link. |
| **Official ChatGPT Shopping** | No partnership, no listing, no merchant feed. What *is* built is **Custom GPT Actions**: a GPT imports `/.well-known/openai-openapi.yaml` and calls a public HTTPS API. Different thing, similar name. |
| **NPCI UAP** | No integration exists in this build. |
| **AP2 credentials / FIDO** | Mandates are hashed and chained, not attested. "AP2-**shaped**". |
| **on-chain x402** | 402 is used as a status code. No chain, no token, no facilitator. |

**Forging a Captured payment would be fraud.** This repo has no code path that
can mint a `pay_…` id. A previous build had a headless payer that tried to drive
the hosted page; it was always blocked, so it was deleted rather than faked.

---

## The 8-click demo

```bash
pnpm install && pnpm dev
```

1. **`localhost:3000`** — dark stage, two doors. Click **As a customer**.
2. **Agent** → type *"buy me niacinamide from Baron"*.
3. The agent finds the real SKU and offers **one** upsell — the extra discount
   shown is what policy would actually allow.
4. **Accept** (or reject). That tap is the last decision: it quotes, approves and
   issues a link in one go.
5. Open the **`rzp.io`** link. Pay with `5267 3181 8797 5449`, any future expiry,
   any CVV, Success on the OTP screen.
6. **Orders → Check for payment.** Baron polls Razorpay; the order flips to
   paid only when Razorpay reports a payment id.
7. **Log out → As a merchant → Orders.** The same order, under **Paid**.
8. **Audit.** `CHAIN OK`, and each row in one English sentence: *"You asked for
   15% and policy allowed 5% via offer_… Payment Link issued. Capture not S2S."*

Try `"buy me the totally fake unicorn cream"` at step 2 — *"I could not find that
product, so I am not adding anything."* No substitution, no order.

---

## Environment

```bash
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Test-mode API keys |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies the webhook's raw-body HMAC |
| `RESUME_SECRET` | Signs the two-round shop token. Must match across instances. |
| `SESSION_SECRET` | Signs the demo role cookie |
| `APP_BASE_URL` | Origin used in machine-readable feeds |

---

## Layout

```
packages/kernel      pure decision core — no imports, no I/O, 16 tests
packages/guard       15 typed AI-mistake codes, each mapped to ALLOW/CLAMP/REJECT
packages/catalog     agent-readable catalog: search, lookup, cart maths
packages/campaigns   campaign windows and spend ceilings
packages/mandates    AP2-shaped intent → cart → payment hash chain
packages/quotes      priced, bounded, expiring offers
packages/orders      append-only order log; paid only when Razorpay says so
packages/ledger      hash-chained audit trail
packages/razorpay    the only Razorpay client
packages/vault       holds a card. Has no charge method, by design.
packages/resume      HMAC-signed two-round tokens
packages/mcp         MCP stdio tools, HTTP-only, never imports the provider
apps/web             customer store + merchant console
```

Further reading: [SHOPPER_AI.md](docs/SHOPPER_AI.md) ·
[CUSTOM_GPT.md](docs/CUSTOM_GPT.md) · [SANDBOX_NOTES.md](docs/SANDBOX_NOTES.md) ·
[POSTMORTEM.md](docs/POSTMORTEM.md)

```bash
pnpm verify
```
