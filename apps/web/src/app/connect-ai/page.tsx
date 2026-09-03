import { StoreChrome } from "@/components/StoreChrome";

import { CopyBlock } from "./CopyBlock";
import { SchemaUrl } from "./SchemaUrl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The exact paragraph from docs/CUSTOM_GPT.md, so the two cannot drift. */
const GPT_INSTRUCTIONS = `You shop at Baron. Never ask for card numbers, CVVs, OTPs or any payment credential — Baron handles payment itself and will never send you one.

When the user wants to buy something, call shopBaron with intent_text set to what they asked for.

If the response status is need_upsell_decision, show the shopper suggestion.message and ask them a single yes or no question. Do not add anything to the basket yourself and do not ask anything else. When they answer, call shopBaron again with the resume_token from the previous response and accept_upsell set to true or false.

If the response status is ready_to_generate, show the total (legal_total_paise divided by 100, in rupees) and the coupon that policy allowed (applied_bps divided by 100, as a percentage). Then tell the shopper to open generate_url to create their payment link. There is no link yet and you must not imply there is one.

If status is not_found, tell the shopper the product was not found and do not suggest a substitute. If status is refused, say the store's policy declined the basket and give the reason.

If verdict is CLAMP, you may mention that the store's policy reduced the discount to applied_bps basis points. Never claim a discount that is not in applied_bps.

This is not official ChatGPT Shopping. It is a demo store on Razorpay test mode.`;

export default function ConnectAiPage() {
  return (
    <StoreChrome>
      <section style={{ padding: "64px 0 32px", maxWidth: "46ch" }}>
        <h1 style={{ fontSize: 40 }}>ChatGPT asks. Baron prices. You open the link.</h1>
        <p className="st-lede">Not official Shopping. A store the model can call.</p>
      </section>

      <div style={{ display: "grid", gap: 20, maxWidth: 760 }}>
        <div className="st-card">
          <h2 style={{ fontSize: 18, marginTop: 0 }}>1. The schema URL</h2>
          <p className="st-muted" style={{ marginTop: 0 }}>
            chatgpt.com → Create a GPT → Configure → Actions → Import from URL.
          </p>
          <SchemaUrl />
          <p className="st-muted" style={{ fontSize: 14, marginBottom: 0 }}>
            Authentication: <strong>None</strong>. Money is gated by the mandate and the kernel, not
            by an API key.
          </p>
        </div>

        <div className="st-card">
          <h2 style={{ fontSize: 18, marginTop: 0 }}>2. The instructions</h2>
          <p className="st-muted" style={{ marginTop: 0 }}>
            Paste this into the GPT&rsquo;s Instructions box, unedited.
          </p>
          <CopyBlock label="GPT instructions" value={GPT_INSTRUCTIONS} multiline />
        </div>

        <div className="st-card">
          <h2 style={{ fontSize: 18, marginTop: 0 }}>3. Try it</h2>
          <p className="st-muted" style={{ marginTop: 0 }}>
            In the GPT preview, say:
          </p>
          <CopyBlock label="Test prompt" value="buy me niacinamide" />
          <p className="st-muted" style={{ fontSize: 14, marginBottom: 0 }}>
            It should find the serum, ask you one yes/no question about an add-on, and then show a
            single <code>rzp.io</code> link. Health check: <a href="/api/health">/api/health</a>
          </p>
        </div>
      </div>

      <div className="st-card" style={{ marginTop: 20, maxWidth: 760 }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>What the GPT will show you</h2>
        <p className="st-muted" style={{ marginTop: 0 }}>
          The same story the shop&rsquo;s own agent tells, in the chat window instead of on this
          site. Six beats, in order:
        </p>
        <ol className="st-beats">
          <li>
            <strong>You asked.</strong> Your sentence, passed through as written.
          </li>
          <li>
            <strong>Found.</strong> One real SKU and its title. If nothing matches confidently the
            GPT says so and stops — it is instructed never to substitute a near match.
          </li>
          <li>
            <strong>Suggested.</strong> At most one add-on, named, with how much extra legal
            discount it would unlock. A campaign may be behind this; a campaign never mints an
            offer id.
          </li>
          <li>
            <strong>You accepted or rejected.</strong> One yes or no. That answer is the last
            decision anyone asks you for.
          </li>
          <li>
            <strong>Policy asked X%, allowed Y%.</strong> The GPT may repeat what policy allowed. It
            is instructed never to claim a discount that is not in <code>applied_bps</code>.
          </li>
          <li>
            <strong>Link, or the reason there isn&rsquo;t one.</strong> A single <code>rzp.io</code>{" "}
            URL and the total. You open it and pay on Razorpay&rsquo;s page.
          </li>
        </ol>
        <p className="st-muted" style={{ fontSize: 14, marginBottom: 0 }}>
          What it will never show you: a card number, a CVV, an OTP, or an order id. It never
          receives them, because it never touches the payment.
        </p>
      </div>

      <div className="st-note" style={{ marginTop: 24, maxWidth: 760 }}>
        When Razorpay allows server charge, this vault is ready. Until then, the payment link is the
        till.
      </div>
    </StoreChrome>
  );
}
