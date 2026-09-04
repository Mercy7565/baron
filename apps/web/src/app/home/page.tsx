import { productById } from "@countersign/catalog";

import { ProductImage } from "@/components/ProductImage";
import { StoreChrome } from "@/components/StoreChrome";
import { CATALOG } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FEATURED = ["sku_serum_niacin_30", "sku_spf_fluid_50", "sku_moist_light_50"];

/**
 * The customer home.
 *
 * This used to live at `/`, which meant the first screen changed depending on
 * who was holding the cookie — a returning shopper never saw the stage again,
 * and the site had no stable front door. `/` is now always the stage; this is
 * where a customer lands after choosing a role, and the customer guard in the
 * middleware keeps it that way.
 */
export default function CustomerHome() {
  const featured = FEATURED.map((id) => productById(CATALOG, id)).filter(
    (p): p is NonNullable<typeof p> => p !== null,
  );

  return (
    <StoreChrome>
      <section style={{ padding: "88px 0 68px" }}>
        {/* The headline gets room to breathe on two lines, not four. */}
        <h1 style={{ maxWidth: "17ch" }}>Buy with a sentence. Pay with a rule.</h1>
        <p className="st-lede">
          Tell the assistant what you want. Your coupon is worked out from your bag, before you
          pay.
        </p>
        <p className="page-help">
          Enter a shop code to browse a merchant&rsquo;s products, then buy in the basket or by
          asking the assistant. Prices and discounts are set by the store, not by the assistant.
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 30, flexWrap: "wrap" }}>
          <a className="st-btn" href="/agent">
            Start with the agent
          </a>
          <a className="st-btn st-btn--quiet" href="/shop">
            Browse the shop
          </a>
        </div>
      </section>

      <section style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {[
          ["Say it once", "“Buy me the niacinamide.” The agent searches the real catalog — it cannot invent a product that does not exist."],
          ["One question", "If adding something unlocks a bigger legal discount, you get asked. Yes or no. That is the last tap."],
          ["Then a link", "You pay on Razorpay. The assistant never sees your card, and never sets the price."],
        ].map(([h, b]) => (
          <div key={h}>
            <h2 style={{ fontSize: 17, marginBottom: 6 }}>{h}</h2>
            <p className="st-muted" style={{ margin: 0, fontSize: 15 }}>
              {b}
            </p>
          </div>
        ))}
      </section>

      <section style={{ marginTop: 64 }}>
        <div className="st-card">
          <h2 style={{ marginTop: 0 }}>Have a shop code?</h2>
          <p className="st-muted" style={{ marginBottom: 18 }}>
            Baron is a platform: each merchant runs their own catalog and hands out a code. Enter
            one to see their shop.
          </p>
          <a className="st-btn" href="/shop">
            Enter a shop code
          </a>
        </div>
      </section>

      <section className="st-note" style={{ marginTop: 56 }}>
        <strong>How payment works here.</strong> A real Razorpay Payment Link is created and you
        complete it on Razorpay&rsquo;s page. There is no server-to-server card capture on this
        account, so nothing is charged behind your back — and we do not pretend otherwise.
      </section>
    </StoreChrome>
  );
}
