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

      <section style={{ marginTop: 72 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 22 }}>
          <h2 style={{ margin: 0 }}>The shop</h2>
          <a className="st-muted" href="/shop" style={{ fontSize: 15 }}>
            All {CATALOG.products.length} products →
          </a>
        </div>

        <div className="st-grid">
          {featured.map((p) => (
            <a key={p.id} href={p.url} style={{ textDecoration: "none", color: "inherit" }}>
              <ProductImage
                src={p.image}
                alt={p.title}
                className="st-tile"
              />
              <div style={{ marginTop: 12, fontSize: 16 }}>{p.title}</div>
              <div className="st-muted nl-money" style={{ fontSize: 15 }}>
                ₹{(p.price_paise / 100).toFixed(2)}
              </div>
            </a>
          ))}
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
