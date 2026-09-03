# Sandbox Notes

Running notes on the Razorpay **test mode** environment: what we observed, what
tripped us up, and anything that behaves differently from the docs. Keep entries
short and dated so the postmortem can be assembled from them later.

## Credentials

Test-mode keys live in `.env` (see `.env.example`). Never commit real keys —
test keys included.

| Variable | Where it comes from |
| --- | --- |
| `RAZORPAY_KEY_ID` | Dashboard → Account & Settings → API Keys (test mode) |
| `RAZORPAY_KEY_SECRET` | Shown once when the key is generated |
| `RAZORPAY_WEBHOOK_SECRET` | Dashboard → Webhooks → the secret you set when creating the endpoint |

## Webhooks

- Endpoint: `POST /api/webhooks/razorpay`
- The signature (`x-razorpay-signature`) is an HMAC-SHA256 of the **raw request
  body** keyed with the webhook secret. Re-serializing the parsed JSON will not
  match — always read the body as text first.
- Local development needs a public URL (tunnel) pointed at `localhost:3000`.

## Observations

_(none yet — add dated entries below as we go)_

## Day 0 — 2026-08-28

### Offer ladder (Dashboard, Test Mode, Card only)

UPI was not enabled on this account, so offers are Card-only.

| Rung | Name | % | Max discount | offer_id |
|---|---|---|---|---|
| 1 | CS 2pct | 2 | 100 | offer_TVGA5zBFGxtmTk |
| 2 | CS 5pct | 5 | 250 | offer_TVGCPhnzBPaP1Q |
| 3 | CS 8pct | 8 | 400 | offer_TVGEG4clW17CPr |
| 4 | CS 11pct | 11 | 500 | offer_TVGGTIycymL77F |
| 5 | CS 15pct | 15 | 500 | offer_TVGHnR32wQf0ZL |

### Other findings
- No public Create Offer API. Offers are Dashboard-only.
- UPI not enabled yet on this merchant.
- line_items / Magic Checkout not tested yet.

## Day 1 Recon

Run `mtdpjfyr` — 2026-08-29T01:34:31.295Z — against `https://api.razorpay.com/v1` in test mode.

| # | Probe | Result | Reason |
| --- | --- | --- | --- |
| 1 | POST /orders — baseline amount=50000 currency=INR receipt=cs-recon-1 | PASS | created order_TVPDQzCh3n7kxa |
| 2 | POST /orders — with CounterSign notes (decision_id, mandate_hash, inputs_hash, policy_version) | PASS | all 4 note keys round-tripped intact on order_TVPDSNDjRrL5lO |
| 3 | POST /orders — notes value length ceiling (100 / 200 / 256 / 512) | PASS | accepted: 100, 200, 256, 512 \| rejected: none |
| 4 | POST /orders — with line_items (report whether plain orders accept them) | FAIL | rejected (400): currency is/are not required and should not be sent |
| 5 | GET /offers — list offers available on this account | FAIL | 400: Request Validation Failure |
| 6 | POST /orders — offers: [{ offer_id }] + force_offer | PASS | object shape did not attach; string-array shape attached on order_TVPDfWnEPOq2GY |
| 7 | POST /payment_links — amount=50000 | PASS | created plink_TVPDhcgLMN1aoa https://rzp.io/rzp/DtWPgha |

### Raw exchanges

#### 1. POST /orders — baseline amount=50000 currency=INR receipt=cs-recon-1

**PASS** — created order_TVPDQzCh3n7kxa

`POST /orders` → `200`

request:
```json
{
  "amount": 50000,
  "currency": "INR",
  "receipt": "cs-recon-1"
}
```

response:
```json
{
  "amount": 50000,
  "amount_due": 50000,
  "amount_paid": 0,
  "attempts": 0,
  "created_at": 1787967256,
  "currency": "INR",
  "entity": "order",
  "id": "order_TVPDQzCh3n7kxa",
  "notes": [],
  "offer_id": null,
  "receipt": "cs-recon-1",
  "status": "created"
}
```

#### 2. POST /orders — with CounterSign notes (decision_id, mandate_hash, inputs_hash, policy_version)

**PASS** — all 4 note keys round-tripped intact on order_TVPDSNDjRrL5lO

`POST /orders` → `200`

request:
```json
{
  "amount": 50000,
  "currency": "INR",
  "receipt": "cs-recon-2-mtdpjfyr",
  "notes": {
    "decision_id": "dec_mtdpjfyr",
    "mandate_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "inputs_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "policy_version": "v0.1.0"
  }
}
```

response:
```json
{
  "amount": 50000,
  "amount_due": 50000,
  "amount_paid": 0,
  "attempts": 0,
  "created_at": 1787967257,
  "currency": "INR",
  "entity": "order",
  "id": "order_TVPDSNDjRrL5lO",
  "notes": {
    "decision_id": "dec_mtdpjfyr",
    "inputs_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "mandate_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "policy_version": "v0.1.0"
  },
  "offer_id": null,
  "receipt": "cs-recon-2-mtdpjfyr",
  "status": "created"
}
```

#### 3. POST /orders — notes value length ceiling (100 / 200 / 256 / 512)

**PASS** — accepted: 100, 200, 256, 512 | rejected: none

`POST /orders` → `200`

request:
```json
{
  "amount": 50000,
  "currency": "INR",
  "receipt": "cs-r3-100-mtdpjfyr",
  "notes": {
    "probe": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

response:
```json
{
  "amount": 50000,
  "amount_due": 50000,
  "amount_paid": 0,
  "attempts": 0,
  "created_at": 1787967259,
  "currency": "INR",
  "entity": "order",
  "id": "order_TVPDU1I8LgaNP6",
  "notes": {
    "probe": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  },
  "offer_id": null,
  "receipt": "cs-r3-100-mtdpjfyr",
  "status": "created"
}
```

`POST /orders` → `200`

request:
```json
{
  "amount": 50000,
  "currency": "INR",
  "receipt": "cs-r3-200-mtdpjfyr",
  "notes": {
    "probe": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

response:
```json
{
  "amount": 50000,
  "amount_due": 50000,
  "amount_paid": 0,
  "attempts": 0,
  "created_at": 1787967260,
  "currency": "INR",
  "entity": "order",
  "id": "order_TVPDVgZC225snV",
  "notes": {
    "probe": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  },
  "offer_id": null,
  "receipt": "cs-r3-200-mtdpjfyr",
  "status": "created"
}
```

`POST /orders` → `200`

request:
```json
{
  "amount": 50000,
  "currency": "INR",
  "receipt": "cs-r3-256-mtdpjfyr",
  "notes": {
    "probe": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

response:
```json
{
  "amount": 50000,
  "amount_due": 50000,
  "amount_paid": 0,
  "attempts": 0,
  "created_at": 1787967262,
  "currency": "INR",
  "entity": "order",
  "id": "order_TVPDXKFAoOMsfo",
  "notes": {
    "probe": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  },
  "offer_id": null,
  "receipt": "cs-r3-256-mtdpjfyr",
  "status": "created"
}
```

`POST /orders` → `200`

request:
```json
{
  "amount": 50000,
  "currency": "INR",
  "receipt": "cs-r3-512-mtdpjfyr",
  "notes": {
    "probe": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

response:
```json
{
  "amount": 50000,
  "amount_due": 50000,
  "amount_paid": 0,
  "attempts": 0,
  "created_at": 1787967263,
  "currency": "INR",
  "entity": "order",
  "id": "order_TVPDYwx3VXIkuc",
  "notes": {
    "probe": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  },
  "offer_id": null,
  "receipt": "cs-r3-512-mtdpjfyr",
  "status": "created"
}
```

#### 4. POST /orders — with line_items (report whether plain orders accept them)

**FAIL** — rejected (400): currency is/are not required and should not be sent

`POST /orders` → `400`

request:
```json
{
  "amount": 50000,
  "currency": "INR",
  "receipt": "cs-recon-4-mtdpjfyr",
  "line_items": [
    {
      "name": "CounterSign recon item",
      "price": 50000,
      "quantity": 1,
      "currency": "INR"
    }
  ]
}
```

response:
```json
{
  "error": {
    "code": "BAD_REQUEST_ERROR",
    "description": "currency is/are not required and should not be sent",
    "metadata": {},
    "reason": "extra_field_sent",
    "source": "business",
    "step": "payment_initiation"
  }
}
```

#### 5. GET /offers — list offers available on this account

**FAIL** — 400: Request Validation Failure

`GET /offers` → `400`

response:
```json
{
  "error": {
    "code": "BAD_REQUEST",
    "description": "Request Validation Failure",
    "source": "NA",
    "step": "NA",
    "reason": "NA"
  }
}
```

#### 6. POST /orders — offers: [{ offer_id }] + force_offer

**PASS** — object shape did not attach; string-array shape attached on order_TVPDfWnEPOq2GY

`POST /orders` → `200`

request:
```json
{
  "amount": 50000,
  "currency": "INR",
  "receipt": "cs-r6a-mtdpjfyr",
  "offers": [
    {
      "offer_id": "offer_TVGA5zBFGxtmTk"
    }
  ],
  "force_offer": 1
}
```

response:
```json
{
  "amount": 50000,
  "amount_due": 50000,
  "amount_paid": 0,
  "attempts": 0,
  "created_at": 1787967268,
  "currency": "INR",
  "entity": "order",
  "id": "order_TVPDduOOvj7E1a",
  "notes": [],
  "offers": null,
  "receipt": "cs-r6a-mtdpjfyr",
  "status": "created"
}
```

`POST /orders` → `200`

request:
```json
{
  "amount": 50000,
  "currency": "INR",
  "receipt": "cs-r6b-mtdpjfyr",
  "offers": [
    "offer_TVGA5zBFGxtmTk"
  ],
  "force_offer": true
}
```

response:
```json
{
  "amount": 50000,
  "amount_due": 50000,
  "amount_paid": 0,
  "attempts": 0,
  "created_at": 1787967269,
  "currency": "INR",
  "entity": "order",
  "id": "order_TVPDfWnEPOq2GY",
  "notes": [],
  "offer_id": "offer_TVGA5zBFGxtmTk",
  "offers": [
    "offer_TVGA5zBFGxtmTk"
  ],
  "receipt": "cs-r6b-mtdpjfyr",
  "status": "created"
}
```

#### 7. POST /payment_links — amount=50000

**PASS** — created plink_TVPDhcgLMN1aoa https://rzp.io/rzp/DtWPgha

`POST /payment_links` → `200`

request:
```json
{
  "amount": 50000,
  "currency": "INR",
  "description": "CounterSign recon probe",
  "reference_id": "cs-recon-7-mtdpjfyr",
  "notify": {
    "sms": false,
    "email": false
  },
  "reminder_enable": false
}
```

response:
```json
{
  "accept_partial": false,
  "allow_full_payment": false,
  "amount": 50000,
  "amount_paid": 0,
  "cancelled_at": 0,
  "created_at": 1787967271,
  "currency": "INR",
  "customer": [],
  "description": "CounterSign recon probe",
  "expire_by": 0,
  "expired_at": 0,
  "first_min_partial_amount": 0,
  "id": "plink_TVPDhcgLMN1aoa",
  "notes": null,
  "notify": {
    "email": false,
    "sms": false,
    "whatsapp": false
  },
  "payment_plan": false,
  "payments": null,
  "reference_id": "cs-recon-7-mtdpjfyr",
  "reminder_enable": false,
  "reminders": [],
  "short_url": "https://rzp.io/rzp/DtWPgha",
  "status": "created",
  "updated_at": 1787967271,
  "upi_link": false,
  "user_id": "",
  "whatsapp_link": false
}
```


## Day 2 — offer attachment, and three mistranscribed offer ids

Wiring `POST /api/checkout/propose` surfaced a follow-on to the Day 1 offers
finding. Sending the correct shape is necessary but **not sufficient**:
`offers: ["offer_..."]` with `force_offer: true` returns HTTP 200 with
`"offers": null` whenever the offer does not actually apply — including when the
offer id does not exist at all.

**We chased a phantom dashboard bug for most of a day.** An initial probe showed
the 5%, 8% and 11% rungs not attaching, and we concluded those offers were
misconfigured or inactive. They were not. All three ids had been mistranscribed
into our ladder:

| Rung | Wrong id we carried | Correct dashboard id | Character |
| --- | --- | --- | --- |
| 5% | `offer_TVGCPhnzBPaF1Q` | `offer_TVGCPhnzBPaP1Q` | `F` → `P` |
| 8% | `offer_TVGEG4clWl7CPr` | `offer_TVGEG4clW17CPr` | lowercase `l` → digit `1` |
| 11% | `offer_TVGTIycymL77F` | `offer_TVGGTIycymL77F` | missing `G` |

With the exact dashboard ids, every rung attaches, at both amounts probed:

| Discount | Offer id | ₹500 | ₹1000 |
| --- | --- | --- | --- |
| 2% | `offer_TVGA5zBFGxtmTk` | attached | attached |
| 5% | `offer_TVGCPhnzBPaP1Q` | attached | attached |
| 8% | `offer_TVGEG4clW17CPr` | attached | attached |
| 11% | `offer_TVGGTIycymL77F` | attached | attached |
| 15% | `offer_TVGHnR32wQf0ZL` | attached | attached |

There is no dashboard problem. There never was one.

### Why this was so expensive

Razorpay does not validate offer ids. A nonexistent offer id returns **HTTP 200**
with `offers: null` — byte-identical to the response for an offer that exists but
does not apply. The API gives you no way to tell "you typed this wrong" apart
from "this offer is inactive", so we spent the investigation looking at the
dashboard instead of at our own string literals. Two of the three ids differ from
the correct ones only in characters that are near-invisible in a proportional
font: `l` versus `1`, and a doubled `G`.

Consequences for the code:

- A created order is never proof that a discount applied.
  `/api/checkout/propose` compares `verdict.offer_ids` against the order's
  returned `offers` and attaches a `warning` when they disagree, so a full-price
  charge can never masquerade as a discounted one. This check is the only reason
  the typos were caught at all.
- Offer ids must be copy-pasted from the dashboard, never retyped or read aloud
  from a screenshot. There is no API-side validation to catch a typo, and the
  failure is completely silent.
- Any future "this offer is broken" hypothesis should start by re-verifying the
  id character by character before anyone opens the dashboard.

## Test cards

Offers on this account are **card-only** (UPI was never enabled), so any demo
that needs a discount to apply must pay by card.

| Use | Number |
| --- | --- |
| Indian test card — **use this one** | `5267318187975449` |
| International Visa — **do not use** | `4111111111111111` |

`4111111111111111` is an international card. It does not exercise the card-only
offer path on this merchant and will not demonstrate a clamped discount being
applied. Use `5267318187975449` with any future expiry, any 3-digit CVV, and
choose Success on the simulated OTP screen.

## Day 5 — the Payment Link cap is per account, for life

Razorpay test mode caps an account at **30 Payment Links ever created**. Once
there, creation answers:

```
HTTP 429
test mode limit of 30 reached for payment_link
```

We hit this mid-demo. The code behaved correctly — `issueLinkForQuote` returned
`payment_link_failed` carrying Razorpay's own words and **did not invent a
`plink_`** — but no further link can be created on this key pair.

**Cancelling does not help.** `POST /payment_links/:id/cancel` returns 200 and
`status: cancelled`, and we cancelled 21 unpaid links to test it. The account
still reported 30 links and creation still returned 429. The cap counts links
*ever created*, not links currently open.

We briefly shipped a `links:cleanup` script on the assumption that cancelling
freed quota. It did not, so the script was deleted rather than left behind
making a promise it cannot keep.

### What this means for a demo

- The **5 paid** and **3 still-open** links on this account remain valid and
  clickable. An existing `rzp.io` link still pays.
- Creating a **new** link needs a **fresh test key pair** — a new Razorpay test
  account, with `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` swapped in `.env`.
  The five dashboard offers in `OFFER_LADDER` would need recreating there too,
  and their ids copied in verbatim.
- Everything upstream of link creation — kernel, guard, quotes, campaign burn,
  orders, audit — runs without touching the cap.
