# Shopping Baron from an outside AI

Baron exposes one endpoint an outside agent can drive end to end:
`POST /api/agent/shop`. It takes two rounds, and the second round is the last
time a human has to decide anything.

**This is not an official ChatGPT Shopping integration.** There is no
partnership, no certification, and no listing. It is a plain HTTP API that
happens to be shaped so a chat tool can call it as a custom Action.

## The contract

### Round 1 — intent

```json
{ "intent_text": "buy me niacinamide", "mandate_hash": "optional" }
```

Two possible answers.

**A. An upsell would unlock more legal discount — ask the human.**

```json
{
  "status": "need_upsell_decision",
  "resume_token": "rt_2987a1081…",
  "found":      { "sku_id": "sku_serum_niacin_30", "title": "…", "price_paise": 84900 },
  "suggestion": { "sku_id": "sku_serum_vitc_30", "title": "…", "price_paise": 129900,
                  "extra_bps": 300, "message": "Adding … unlocks an extra 3% that policy allows." },
  "quote_preview": { "without_upsell_subtotal_paise": 84900,
                     "with_upsell_subtotal_paise": 214800, "note": "…" },
  "payment_link_id": null,
  "short_url": null
}
```

**B. No upsell worth asking about — go straight to a link** (same shape as
round 2's answer below).

**C. The product does not exist.** No substitution, ever:

```json
{ "status": "not_found",
  "message": "I could not find that product, so I am not adding anything.",
  "payment_link_id": null, "short_url": null }
```

### Round 2 — yes or no

```json
{ "resume_token": "rt_…", "accept_upsell": true }
```

```json
{
  "status": "ready_to_pay",
  "quote_id": "qt_…",
  "payment_link_id": "plink_TWzGKVYgTeZFxj",
  "short_url": "https://rzp.io/rzp/ultCFUyB",
  "legal_total_paise": 204060,
  "verdict": "CLAMP",
  "applied_bps": 500,
  "offer_id": "offer_TVGCPhnzBPaP1Q",
  "razorpay_order_id": "order_…",
  "upsell_accepted": true
}
```

A refused basket answers `status: "refused"` with `payment_link_id: null` and
the mistake codes that caused it.

### Keys a chat tool should depend on

| key | why |
| --- | --- |
| `status` | `need_upsell_decision` \| `ready_to_pay` \| `not_found` \| `refused` \| `expired` |
| `resume_token` | Round 1 → round 2. Expires after 15 minutes, single use. |
| `suggestion.title`, `suggestion.extra_bps` | What to ask the human |
| `short_url` | **The only thing to show the buyer at the end** |
| `payment_link_id` | Reference for support; always starts `plink_` |
| `legal_total_paise` | Integer paise. Divide by 100 to display rupees. |
| `verdict`, `applied_bps` | Proof the discount was decided by policy, not by asking |

The agent never receives a card number or a one-time code, because it never
touches either. The buyer pays the `short_url` on Razorpay's own page.

## curl — local

```bash
BASE_URL=http://localhost:3000
```

Round 1:

```bash
curl -s -X POST $BASE_URL/api/agent/shop -H "content-type: application/json" -d '{"intent_text":"buy me niacinamide"}'
```

Round 2, accept:

```bash
curl -s -X POST $BASE_URL/api/agent/shop -H "content-type: application/json" -d '{"resume_token":"PASTE_TOKEN","accept_upsell":true}'
```

Round 2, reject:

```bash
curl -s -X POST $BASE_URL/api/agent/shop -H "content-type: application/json" -d '{"resume_token":"PASTE_TOKEN","accept_upsell":false}'
```

## curl — after deploy

**ChatGPT cannot reach `localhost`.** A custom Action runs on OpenAI's servers,
so the host must be publicly reachable. After deploying to Vercel, replace the
base URL — **the paths do not change**.

```bash
BASE_URL=https://YOUR_VERCEL_HOST
```

```bash
curl -s -X POST $BASE_URL/api/agent/shop -H "content-type: application/json" -d '{"intent_text":"buy me niacinamide"}'
```

```bash
curl -s -X POST $BASE_URL/api/agent/shop -H "content-type: application/json" -d '{"resume_token":"PASTE_TOKEN","accept_upsell":true}'
```

```bash
curl -s -X POST $BASE_URL/api/agent/shop -H "content-type: application/json" -d '{"resume_token":"PASTE_TOKEN","accept_upsell":false}'
```

## As a ChatGPT Action

Add a custom Action with this OpenAPI fragment, swapping the server URL:

```yaml
openapi: 3.1.0
info:
  title: Baron
  version: "0.1.0"
servers:
  - url: https://YOUR_VERCEL_HOST
paths:
  /api/agent/shop:
    post:
      operationId: shopBaron
      summary: Shop Baron. Round 1 sends intent_text; round 2 sends resume_token and accept_upsell.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                intent_text:   { type: string }
                mandate_hash:  { type: string }
                resume_token:  { type: string }
                accept_upsell: { type: boolean }
      responses:
        "200":
          description: A decision request, a payment link, or a refusal.
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:            { type: string }
                  resume_token:      { type: string }
                  suggestion:        { type: object }
                  quote_preview:     { type: object }
                  payment_link_id:   { type: string, nullable: true }
                  short_url:         { type: string, nullable: true }
                  legal_total_paise: { type: integer }
                  verdict:           { type: string }
                  applied_bps:       { type: integer }
```

Suggested instructions for the GPT:

> Call `shopBaron` with the shopper's request as `intent_text`. If the
> reply is `need_upsell_decision`, show `suggestion.message` and ask the shopper
> yes or no — nothing else. Then call again with the `resume_token` and
> `accept_upsell`. When you get `ready_to_pay`, show only `short_url` and the
> total. Never ask for card details; Baron never sends them and never
> needs them.

## What the buyer sees

One question — accept the suggestion or not — and then a link. The discount on
that link was chosen by Baron's kernel, not by the agent: ask for 15% on a
basket that only supports 2% and you get 2%, with the clamp recorded in the
audit trail at `/audit`.

## resume_token durability

Tokens are written to `apps/web/.data/shop_resume.jsonl` and reloaded on boot, so
round 2 survives a restart. They are single-use and expire after 15 minutes.

**Serverless limit:** each instance has its own ephemeral filesystem. A token
minted on one instance may not be readable on another, and the endpoint answers
`{ "status": "expired" }` rather than guessing. If round 2 starts failing after
deploy, this is why — it needs a shared store (Redis, KV, or a database).
