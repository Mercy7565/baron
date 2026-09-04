# Baron as a Custom GPT

A Custom GPT shops a Baron store through six Actions: it resolves a shop code,
searches the catalog, prices a basket, and turns an agreed price into a Razorpay
Payment Link. The GPT never sees a card number, a CVV, a one-time code, a
Razorpay secret or the contents of a wallet - not because a filter strips them,
but because no endpoint on this surface ever puts one in a response.

**This is not official ChatGPT Shopping.** There is no partnership, no listing,
no merchant feed, no certification. It is a plain HTTPS API imported as a custom
Action, which is a different thing wearing a similar name.

## Before you start

The GPT runs on OpenAI's servers, so `localhost` is unreachable. Deploy first,
then use the deployed origin as `{BASE}` everywhere below. The live demo is
`https://baron-shop.vercel.app`.

## Setup on chatgpt.com

1. **Create a GPT** - chatgpt.com -> your name -> *My GPTs* -> *Create a GPT* ->
   *Configure*.
2. **Add the Actions** - scroll to *Actions* -> *Create new action* -> *Import
   from URL*, and paste:

   ```
   {BASE}/.well-known/openai-openapi.yaml
   ```

   Eight operations appear: `resolve_shop_code`, `search_catalog`,
   `get_product`, `create_quote`, `get_quote`, `pay_quote`, `get_payment`,
   `suggest_add_on`.
3. **Authentication** - *API Key*, Auth Type *Custom*, header name
   `x-baron-shopper`, value `aryan`. This is demo identity only: it maps the GPT
   to the built-in demo customer so its orders appear in that account's Orders
   page. Money is gated by the mandate and the kernel, never by this header, and
   an unrecognised value simply shops as the shared demo buyer.
4. **Paste the instructions** below into the GPT's *Instructions* box.
5. **Test** in the preview pane: *"shop code BARON-SKIN, buy me niacinamide"*.

## Instructions to paste

These are the same words the /connect-ai page hands you, and a test keeps the
two identical.

> You shop Baron stores. Always resolve the shop code first.
> Never invent a price or SKU. Never ask for a card.
> If the user says buy X, search, quote, show legal_total, then pay only after they say yes.
>
> How to use the Actions:
>
> 1. resolve_shop_code — call this before anything else, every conversation. If the shopper has not given you a code, ask for one. The demo store is BARON-SKIN. If the code returns 404, tell them it did not work and ask again. Never guess a code.
>
> 2. search_catalog — pass the shopper's own words. Use confident_match. If confident_match is null, this shop does not sell that: say so and stop. Do not offer a product from results that the shopper did not ask for.
>
> 3. get_product — optional, when the shopper wants detail before deciding.
>
> 4. create_quote — the only place a price comes from. Send the sku_id from confident_match. Show the shopper legal_total_inr and nothing else as the price. If you already said a number out loud, pass it as spoken_total and then correct yourself: it is recorded and ignored. If verdict is CLAMP, the store reduced the discount — you may say so, and you may never claim a discount other than applied_bps.
>
> 5. get_quote — use if the conversation paused and you need to check the price still stands. If it is expired, quote again and tell the shopper the new number.
>
> 6. pay_quote — only after the shopper has seen the total and said yes. Give them short_url. Nothing is paid yet: the link is an invitation, not a receipt.
>
> 7. get_payment — after pay, call this when they ask if it went through. It reads Razorpay, so it answers even if the quote is no longer on the server. Report paid and the captured amount; if it is not paid, give short_url again.
>
> 8. suggest_add_on — after a quote, offer at most one real add-on from this action and nothing else. Ask the shopper before adding it, then call create_quote with the new lines. Never invent a product or a price, and never offer a second discount.
>
> Never ask for a card number, a CVV, an expiry date or a one-time code. You will never be given one and you cannot take a payment. The shopper pays on Razorpay's own page, which you cannot see.
>
> This is a Custom GPT using Actions against a demo store on Razorpay test mode. It is not official ChatGPT Shopping.

## The actions

| Action | Method and path | What it is for |
| --- | --- | --- |
| `resolve_shop_code` | `POST /api/gpt/shop-code` | Name the shop. Required before anything else; an unknown code is a 404 with no fallback store. |
| `search_catalog` | `GET /api/gpt/search` | Find products. `confident_match` is null when nothing really matches - that means "not sold here", not "pick the closest". |
| `get_product` | `GET /api/gpt/product` | One product by `sku_id`. No margin, no cost. |
| `create_quote` | `POST /api/gpt/quote` | The only place a total is decided. |
| `get_quote` | `GET /api/gpt/quote/{quoteId}` | Read a price back. An expired quote says so rather than re-pricing itself. |
| `pay_quote` | `POST /api/gpt/pay` | Turn an agreed quote into a Payment Link. Captures nothing. |
| `get_payment` | `GET /api/gpt/payment` | Did the money move? Reads Razorpay, so it answers after the local quote is gone. |
| `suggest_add_on` | `GET /api/gpt/suggest` | At most one in-stock add-on from bought-together data or a live campaign. |

## What a spoken price is worth

`create_quote` accepts `spoken_total`: any figure the model already said out
loud. It is echoed back as `honoured: false` and plays no part in the
arithmetic. A model that has told a shopper "that'll be 500 rupees" has an
obvious incentive to make the bill agree, and an agent that could assert its own
price would make every other guarantee here decorative.

`requested_discount_bps` is an ask, not an instruction. The kernel answers
`ALLOW`, or `CLAMP` when it reduced the discount to what the basket actually
qualifies for. `applied_bps` is the only discount the model may repeat.

## curl - the whole flow

```bash
BASE=https://baron-shop.vercel.app
H='x-baron-shopper: aryan'

curl -s -X POST "$BASE/api/gpt/shop-code" -H "$H" -H 'content-type: application/json'   -d '{"code":"BARON-SKIN"}'

curl -s "$BASE/api/gpt/search?q=niacinamide&shop_code=BARON-SKIN" -H "$H"

curl -s -X POST "$BASE/api/gpt/quote" -H "$H" -H 'content-type: application/json'   -d '{"shop_code":"BARON-SKIN","sku_lines":[{"sku_id":"sku_serum_niacin_30","qty":2}],"requested_discount_bps":2500,"spoken_total":50000}'

curl -s -X POST "$BASE/api/gpt/pay" -H "$H" -H 'content-type: application/json'   -d '{"quote_id":"PASTE_QUOTE_ID"}'
```

## The older two-round endpoint

`POST /api/agent/shop` still works and keeps its own schema at
`/api/agent/openapi.yaml`. It takes an intent, asks at most one yes/no question,
and stops at a quote. The six-action surface above supersedes it for new GPTs
because each step is separately inspectable, which is the part worth showing.

## What the merchant side does not expose

The merchant console - catalog, campaign budgets, orchestrator, audit - is
website-only and sits behind a merchant session. The GPT surface is the customer
half and nothing else.
