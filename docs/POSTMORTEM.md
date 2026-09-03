# Postmortem

Written as we go. The point is what we would do differently, not a narration of
what happened.

## What we set out to build

CounterSign Core for the Razorpay AI Buildathon (Track 01): a deterministic
kernel that sits in front of money movement. An agent proposes a money action,
the kernel decides — allow, clamp, reject, or escalate — and every decision is
reconstructible after the fact from what we wrote into the order.

## Status

| Day | State |
| --- | --- |
| Day 0 | Done — test keys, 5 dashboard offers, Vercel live, webhook returning 200 |
| Day 1 | Done — sandbox recon complete, API surface locked (see `SANDBOX_NOTES.md`) |
| Day 2 | Done — contracts, pure kernel, kernel tests, first money path wired |
| Day 3 | Done — mistake catalog, agent-readable catalog, campaigns, protocol faces |
| Day 4 | Done — quotes, orders, wallet, customer/merchant split, role auth |
| Day 5 | Done — S2S ruled out, Payment Links shipped as the settlement face, dead capture paths deleted |

## Day 0 findings

Environment came up without much drama.

- Razorpay **test-mode** keys issued and working.
- **Five offers** created in the dashboard, forming the discount ladder we now
  treat as the only legal discount values (2 / 5 / 8 / 11 / 15 percent).
- **Vercel deploy is live** from the repo root. Two config problems had to be
  solved to get there, both worth remembering:
  1. Vercel ran `npm install` and died on `workspace:*`. It picks the package
     manager from the committed lockfile; without a committed `pnpm-lock.yaml`
     it falls back to npm, which cannot resolve pnpm workspace protocol. Fixed
     with an explicit `installCommand` in `vercel.json`.
  2. Then: "No Next.js version detected". Framework detection reads the
     package.json at the project's Root Directory, and ours is the repo root,
     where `next` was not listed. Fixed by adding `next`/`react`/`react-dom` to
     the root `dependencies`.
- **Webhook endpoint returns 200** at `/api/webhooks/razorpay`, with raw-body
  signature verification in place.

The deploy config is a workaround, not a design: the Next version is now pinned
in two package.json files and can drift. Noted under "what we would do
differently".

## Day 1 findings (sandbox recon)

Seven probes against the live test-mode API. Raw request/response pairs are in
`SANDBOX_NOTES.md` under "Day 1 Recon". The material results:

**What works and is now load-bearing**

- `POST /orders` with `amount` / `currency` / `receipt` — baseline, fine.
- **`notes` carry our four keys intact.** `decision_id`, `mandate_hash`,
  `inputs_hash` and `policy_version` all round-tripped byte-for-byte. This is
  the whole audit story: the order itself carries the pointer back to the
  decision that authorized it.
- **`notes` values survived 512 characters un-truncated.** We probed 100 / 200 /
  256 / 512 and found no ceiling — the real limit is somewhere above 512, which
  we never bracketed. Hex digests at 64 chars are far inside whatever the bound
  is, so this stopped mattering.
- `POST /payment_links` works with a bare amount.

**What does not work, and cost us time**

- **`offers: [{ offer_id: "..." }]` is a silent no-op.** It returns **HTTP 200**
  and the created order comes back with `"offers": null`. The offer is simply
  not attached. Only `offers: ["offer_..."]` with `force_offer: true` actually
  populates the array. This is the single most dangerous thing we found: a 200
  that quietly did nothing. Had we trusted the status code, we would have
  shipped a discount system that never applied a discount and looked healthy
  doing it.
- **`line_items` rejected** — 400, `extra_field_sent`, complaining about
  `currency` rather than about `line_items`. The shape likely belongs to a
  different order type. We are not pursuing it; the cart lives in our own DB.
- **`GET /offers` returns 400** `Request Validation Failure` with no usable
  detail. We cannot enumerate offers over the API, so the ladder is hardcoded
  from the dashboard.

**Method note.** The first recon run reported the offers probe as failing with
`Too many requests`. That was the sandbox rate-limiting back-to-back calls, not
an API rejection — the two are indistinguishable if you only look at pass/fail.
Adding a 1.5s inter-call throttle and a single 429 retry turned that false
negative into the real (and much more interesting) `offers: null` finding.
Lesson: a probe that cannot tell "rejected" from "throttled" is not a probe.

## Locked API facts

These are settled. Re-litigating them costs a day.

- Do **not** use `line_items`.
- Do **not** use `GET /offers`.
- Do **not** use `offers: [{ offer_id }]`.
- **Do** use `offers: ["offer_..."]` together with `force_offer: true`.
- **Do** put `decision_id`, `mandate_hash`, `inputs_hash`, `policy_version` in
  `notes`.
- Cart lives in our DB, not in Razorpay.

Offer ladder (dashboard-created, hardcoded because `GET /offers` is unusable):

| Discount | Offer id |
| --- | --- |
| 2% | `offer_TVGA5zBFGxtmTk` |
| 5% | `offer_TVGCPhnzBPaP1Q` |
| 8% | `offer_TVGEG4clW17CPr` |
| 11% | `offer_TVGGTIycymL77F` |
| 15% | `offer_TVGHnR32wQf0ZL` |

## Day 2 findings (first money path)

`POST /api/checkout/propose` now runs the full path: proposal in, kernel decides,
and only ALLOW or CLAMP reaches Razorpay. REJECT and ESCALATE never touch the
payment provider.

The day was dominated by one self-inflicted problem. Three of the five offer ids
in our ladder had been mistranscribed — `F` for `P`, a lowercase `l` for a digit
`1`, and a dropped `G`. Every one of those rungs silently failed to apply its
discount, and we spent hours investigating the Razorpay dashboard before
discovering the ids in our own source were wrong. With the exact dashboard ids,
all five rungs attach.

The reason this was expensive: **Razorpay does not validate offer ids.** A
nonexistent id returns HTTP 200 with `offers: null`, which is byte-identical to
the response for an offer that exists but does not apply. The API cannot tell you
that you typed it wrong, so the evidence pointed at the dashboard rather than at
us. Full detail in `SANDBOX_NOTES.md`.

## What went well

- Recon before implementation. Every one of the locked facts above would have
  been discovered mid-build otherwise, at much higher cost.
- Making the recon script assert on *effects* rather than status codes. The
  `offers: null` finding only exists because the probe checked whether the offer
  actually attached.
- The propose route comparing requested offers against the offers Razorpay
  actually returned. That one check is the only reason three mistranscribed offer
  ids were noticed at all, instead of shipping a ladder where three of five rungs
  silently charged full price.

## What went wrong

- Two Vercel deploy failures, both from monorepo detection rather than from
  anything we wrote. Roughly an hour, all of it before any product code existed.
- One recon run wasted to rate limiting misread as rejection.
- Three mistranscribed offer ids, and a long investigation into a dashboard
  misconfiguration that did not exist. We twice concluded the offers were broken
  before checking our own string literals.

## Surprises

- A 200 response that silently discards a field. This reframed how we test:
  assert the resulting state, never the status code.
- `GET /offers` being unusable while offers themselves work fine when referenced
  by id.
- An API that accepts a completely nonexistent offer id with a 200 and no warning
  of any kind.

## What we would do differently

- Commit the lockfile before pointing any hosting provider at the repo.
- Build throttle and retry into any probe tool from the first line, not after a
  confusing result.
- Treat "did the field survive the round trip?" as the default assertion for
  every new Razorpay field we adopt.
- Copy-paste every external identifier. Never retype one, never transcribe one
  from a screenshot, and suspect our own string literals before blaming a third
  party's configuration.

## Day 4-5 findings (settlement)

The remaining question was whether an agent could complete a payment without a
human. Three dead ends, in order, each with the id or error that closed it.

**1. There is no server-to-server card API on this account.**
`POST https://api.razorpay.com/v1/payments/create/json` answers:

```
code: BAD_REQUEST_ERROR
description: The requested URL was not found on the server.
```

Not a permissions error, not a validation error — the route does not exist for
this merchant. Checkout.js in a browser is the only real capture path.

**2. Driving the hosted page with a headless browser is blocked.**
We built a payer on playwright-core against the real Chrome install and ran it
three times against live links (`plink_TWyhTzfCxKv0W6`, `plink_TWylujDod363ge`,
`plink_TWynEDWLRM9uR1`). Every run created the Payment Link successfully and
then failed to complete it.

Inspecting the page in a normal browser explained why: the landing page is a
summary with a **Proceed to Pay** control that is a `div`, not a button; the
real checkout mounts in an **iframe** at `api.razorpay.com/v1/checkout/public`;
and behind that sits a contact-details gate before any payment method appears.
We fixed the selectors for all three. Headless Chrome still never surfaced
"Proceed to Pay" within 25 seconds, while the same URL rendered it instantly in
a normal browser.

The payer never invented a payment id. It returned `capture_mode: "blocked"`
with the real error, and the audit row said so.

**3. Recurring / token-based charging is not available either.**
The token list for this merchant is empty, so there is no saved instrument to
charge even if an S2S route existed. The vault stores `last4`, `brand` and a
token id and stops there.

### What we shipped instead

**The Razorpay Payment Link is the settlement face.** Every agent purchase
creates a real link (`plink_…`, `rzp.io/rzp/…`), visible in Dashboard → Payment
Links, and the buyer completes it on Razorpay's page or on `/gate` through
Checkout.js. An order is `awaiting_payment` until `fetchPaymentLink` reports a
payment id; `markPaid("")` returns null, so there is no path to a paid order
without Razorpay saying so.

### The cleanup this forced

Once Payment Links became the money path, the simulated-capture code was a
second, fake money path sitting next to the real one — exactly the thing a judge
should not have to disambiguate. We deleted `packages/vault/src/payer.ts`,
`apps/web/src/server/pay.ts` and the two `/pay` routes, removed
`otp_handled_by_vault` from every live response, and renamed `SimulatedCapture`
to `Wallet` because a class that cannot capture should not be called one. A test
now asserts those files stay deleted and that the wallet exposes no `charge`
method.

### What we would do differently

- Probe the *hosted page* structure before writing a single automation selector.
  We wrote three versions against guesses; ten minutes in devtools first would
  have produced the iframe and the contact gate immediately.
- Treat "the API returns 404" as a product decision point, not a bug to retry.
  The day it appeared was the day the architecture should have moved to Payment
  Links, and we spent hours after that on automation that could not work.
