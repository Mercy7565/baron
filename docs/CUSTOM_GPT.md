# Baron as a Custom GPT

A Custom GPT can shop Baron end to end: the shopper says what they want,
the GPT asks at most one yes/no question, and hands back a Razorpay payment
link. The GPT never sees a card number or a one-time code, because Baron
never sends them and never needs them.

**This is not official ChatGPT Shopping.** There is no partnership, no listing,
no certification. It is a plain HTTP API imported as a custom Action.

## Before you start

The GPT runs on OpenAI's servers, so `localhost` is unreachable. Deploy first,
then use the deployed origin as `{BASE}` everywhere below.

Set `RESUME_SECRET` in the deployment's environment. The two-round token is
signed with it and carries its own state, so round 2 works even when it lands on
a different serverless instance than round 1. Any value works as long as every
instance shares it.

## Setup on chatgpt.com

1. **Create a GPT** — chatgpt.com → your name → *My GPTs* → *Create a GPT* →
   *Configure*.
2. **Add the Action** — scroll to *Actions* → *Create new action* → *Import from
   URL*, and paste:

   ```
   {BASE}/api/agent/openapi.yaml
   ```

   One operation appears: `shopBaron`.
3. **Authentication** — leave as **None**. The API is public; money is gated by
   the mandate and the kernel, not by an API key.
4. **Paste the instructions** below into the GPT's *Instructions* box.
5. **Test** in the preview pane: *"buy me niacinamide from Baron"*.

## Instructions to paste

> You shop at Baron. Never ask for card numbers, CVVs, OTPs or any payment
> credential — Baron handles payment itself and will never send you one.
>
> When the user wants to buy something, call `shopBaron` with
> `intent_text` set to what they asked for.
>
> If the response `status` is `need_upsell_decision`, show the shopper
> `suggestion.message` and ask them a single yes or no question. Do not add
> anything to the basket yourself and do not ask anything else. When they
> answer, call `shopBaron` again with the `resume_token` from the previous
> response and `accept_upsell` set to true or false.
>
> If the response `status` is `ready_to_generate`, show the total
> (`legal_total_paise` divided by 100, in rupees) and the coupon that policy
> allowed (`applied_bps` divided by 100, as a percentage). Then tell the shopper
> to open `generate_url` to create their payment link. There is no link yet and
> you must not imply there is one.
>
> If `status` is `not_found`, tell the shopper the product was not found and do
> not suggest a substitute. If `status` is `refused`, say the store's policy
> declined the basket and give the `reason`.
>
> If `verdict` is `CLAMP`, you may mention that the store's policy reduced the
> discount to `applied_bps` basis points. Never claim a discount that is not in
> `applied_bps`.
>
> This is not official ChatGPT Shopping. It is a demo store on Razorpay test
> mode.

## The contract

**Round 1**

```json
{ "intent_text": "buy me niacinamide" }
```

**Round 2**

```json
{ "resume_token": "rt_…", "accept_upsell": true }
```

`status` is one of:

| status | what the GPT should do |
| --- | --- |
| `need_upsell_decision` | Show `suggestion.message`, ask yes/no, call again with `resume_token` |
| `ready_to_pay` | Show **only** `short_url` and the rupee total |
| `not_found` | Say it was not found. No substitutes. |
| `refused` | Say policy declined, give `reason` |

`ready_to_pay` carries `short_url`, `payment_link_id`, `legal_total_paise`,
`verdict` and `applied_bps`.

## resume_token

Signed with HMAC-SHA256 over its own payload — the intent, the basket lines, the
suggestions and an expiry. There is no server-side session to lose, so round 2
works across instances. It expires **15 minutes** after round 1; after that the
API answers `410` with `status: "expired"` and the GPT should start again.

## curl — local

```bash
curl -s -X POST http://localhost:3000/api/agent/shop -H "content-type: application/json" -d '{"intent_text":"buy me niacinamide"}'
```

```bash
curl -s -X POST http://localhost:3000/api/agent/shop -H "content-type: application/json" -d '{"resume_token":"PASTE_TOKEN","accept_upsell":true}'
```

## curl — after deploy

```bash
curl -s -X POST https://YOUR_HOST/api/agent/shop -H "content-type: application/json" -d '{"intent_text":"buy me niacinamide"}'
```

```bash
curl -s -X POST https://YOUR_HOST/api/agent/shop -H "content-type: application/json" -d '{"resume_token":"PASTE_TOKEN","accept_upsell":true}'
```

## What the merchant side does not expose

The merchant console — catalog, campaign budgets, orchestrator, audit — is
website-only and sits behind a merchant session. The GPT surface is the customer
half and nothing else.
