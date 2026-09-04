import { StoreChrome } from "@/components/StoreChrome";
import { baseUrl } from "@/lib/catalog";
import { SHOPPER_HEADER } from "@/server/gpt-shopper";

import { CopyBlock } from "./CopyBlock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The instructions a judge pastes into a Custom GPT.
 *
 * The first four lines are the whole policy; everything after them is
 * operational detail for the six Actions. They are written as prohibitions
 * rather than as encouragement because that is what a model in a shop needs:
 * the failure mode is not laziness, it is confidently inventing a product or a
 * price and then acting on it.
 */
const GPT_INSTRUCTIONS = `You shop Baron stores. Always resolve the shop code first.
Never invent a price or SKU. Never ask for a card.
If the user says buy X, search, quote, show legal_total, then pay only after they say yes.

How to use the Actions:

1. resolve_shop_code — call this before anything else, every conversation. If the shopper has not given you a code, ask for one. The demo store is BARON-SKIN. If the code returns 404, tell them it did not work and ask again. Never guess a code.

2. search_catalog — pass the shopper's own words. Use confident_match. If confident_match is null, this shop does not sell that: say so and stop. Do not offer a product from results that the shopper did not ask for.

3. get_product — optional, when the shopper wants detail before deciding.

4. create_quote — the only place a price comes from. Send the sku_id from confident_match. Show the shopper legal_total_inr and nothing else as the price. If you already said a number out loud, pass it as spoken_total and then correct yourself: it is recorded and ignored. If verdict is CLAMP, the store reduced the discount — you may say so, and you may never claim a discount other than applied_bps.

5. get_quote — use if the conversation paused and you need to check the price still stands. If it is expired, quote again and tell the shopper the new number.

6. pay_quote — only after the shopper has seen the total and said yes. Give them short_url. Nothing is paid yet: the link is an invitation, not a receipt.

Never ask for a card number, a CVV, an expiry date or a one-time code. You will never be given one and you cannot take a payment. The shopper pays on Razorpay's own page, which you cannot see.

This is a Custom GPT using Actions against a demo store on Razorpay test mode. It is not official ChatGPT Shopping.`;

export default function ConnectAiPage() {
  const base = baseUrl();
  const schema = `${base}/.well-known/openai-openapi.yaml`;
  const isLocal = base.includes("localhost");

  return (
    <StoreChrome>
      <h1>The model shops. Baron settles.</h1>
      <p className="st-lede">
        A Custom GPT can search this store, price a basket and hand you a payment link — and cannot
        move a rupee the kernel has not already agreed to.
      </p>
      <p className="judge-note">
        Custom GPT Actions against a public HTTPS API. Not official ChatGPT Shopping, and not
        presented as it. The model never receives a card number, a CVV, a one-time code, a Razorpay
        secret or the contents of a wallet, because no endpoint here puts one in a response.
      </p>

      {isLocal && (
        <p className="st-note" style={{ marginBottom: 20 }}>
          This page is being served from <code>localhost</code>, so the URL below is the local one. A
          Custom GPT runs on OpenAI&rsquo;s servers and cannot reach it — open this page on the
          deployed host to get the public address.
        </p>
      )}

      <div style={{ display: "grid", gap: 20, maxWidth: 780 }}>
        <div className="st-card">
          <h2>1 · Import the schema</h2>
          <p className="st-muted" style={{ marginTop: 0 }}>
            chatgpt.com → <strong>Create a GPT</strong> → <strong>Configure</strong> →{" "}
            <strong>Actions</strong> → <strong>Import from URL</strong>. Paste this and click
            Import.
          </p>
          <CopyBlock label="Action schema URL" value={schema} />
          <p className="st-muted" style={{ fontSize: 14, marginBottom: 0 }}>
            Six actions appear: <code>resolve_shop_code</code>, <code>search_catalog</code>,{" "}
            <code>get_product</code>, <code>create_quote</code>, <code>get_quote</code>,{" "}
            <code>pay_quote</code>.
          </p>
        </div>

        <div className="st-card">
          <h2>2 · Set authentication</h2>
          <p className="st-muted" style={{ marginTop: 0 }}>
            Under Actions → Authentication choose <strong>API Key</strong>, set Auth Type to{" "}
            <strong>Custom</strong>, and use this header name with the value <code>aryan</code>.
            That maps the GPT to the built-in demo customer, so its orders land in the same Orders
            page you can open in a browser.
          </p>
          <CopyBlock label="Custom header name" value={SHOPPER_HEADER} />
          <p className="st-muted" style={{ fontSize: 14, marginBottom: 0 }}>
            Demo identity only, and labelled as such. Money is gated by the mandate and the kernel,
            never by this header — an unrecognised value simply shops as the shared demo buyer.
          </p>
        </div>

        <div className="st-card">
          <h2>3 · Paste the instructions</h2>
          <p className="st-muted" style={{ marginTop: 0 }}>
            Into the GPT&rsquo;s <strong>Instructions</strong> box, unedited.
          </p>
          <CopyBlock label="GPT instructions" value={GPT_INSTRUCTIONS} multiline />
        </div>

        <div className="st-card">
          <h2>4 · Try it</h2>
          <p className="st-muted" style={{ marginTop: 0 }}>
            In the GPT preview, say this. It should ask for a shop code, or take{" "}
            <code>BARON-SKIN</code> if you give it one.
          </p>
          <CopyBlock label="Test prompt" value="shop code BARON-SKIN, buy me niacinamide" />
          <p className="st-muted" style={{ fontSize: 14, marginBottom: 0 }}>
            The schema is public and readable in a browser:{" "}
            <a href="/.well-known/openai-openapi.yaml">/.well-known/openai-openapi.yaml</a>
          </p>
        </div>
      </div>

      <div className="st-card" style={{ marginTop: 20, maxWidth: 780 }}>
        <h2>The part worth filming</h2>
        <p className="st-muted" style={{ marginTop: 0 }}>
          Ask the GPT for a discount it has not earned, or let it state a price before it has
          quoted. Then watch what the store does with that:
        </p>
        <ol className="st-beats">
          <li>
            <strong>It asks for 25%.</strong> <code>requested_discount_bps: 2500</code> goes in as a
            request, not an instruction.
          </li>
          <li>
            <strong>The kernel clamps it to 11%.</strong> <code>verdict: CLAMP</code>, and{" "}
            <code>applied_bps</code> is the number the model is allowed to repeat. The rung is
            chosen from the ask, the minimum cart and the merchant&rsquo;s margin floor.
          </li>
          <li>
            <strong>It says the total is ₹500.</strong> That figure travels as{" "}
            <code>spoken_total</code>, comes back{" "}
            <code>honoured: false</code>, and changes nothing. The catalog and the kernel set the
            price.
          </li>
          <li>
            <strong>It asks for a product that does not exist.</strong>{" "}
            <code>confident_match</code> is null and no near match is substituted, so there is no
            quote and nothing to pay for.
          </li>
          <li>
            <strong>It gets a link, not a charge.</strong> <code>paid: false</code>. A Payment Link
            is an invitation; it becomes revenue only when Razorpay says a payment was captured.
          </li>
        </ol>
        <p className="st-muted" style={{ fontSize: 14, marginBottom: 0 }}>
          What it never gets: a card number, a CVV, a one-time code, an API secret, or a wallet.
          Those are not withheld by a filter — they are never assembled into a response.
        </p>
      </div>
    </StoreChrome>
  );
}
