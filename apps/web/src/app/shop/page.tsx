import { ProductCard } from "@/components/ProductCard";
import { CATALOG } from "@/lib/catalog";

import { StoreChrome } from "@/components/StoreChrome";
import { enteredCode, unlockedTenant } from "@/server/shop-code";

import { ExitShop } from "./ExitShop";
import { ShopCodeGate } from "./ShopCodeGate";

export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const sellable = CATALOG.products.filter((p) => !p.blocked && p.availability === "in_stock");
  const rest = CATALOG.products.filter((p) => p.blocked || p.availability !== "in_stock");

  const tenant = await unlockedTenant();
  const code = await enteredCode();

  if (tenant === null) {
    return (
      <StoreChrome>
        <section style={{ padding: "56px 0 8px" }}>
          <h1 style={{ fontSize: 34 }}>Shop</h1>
          <p className="judge-note">
            Baron is a platform. A merchant loads a catalog and gets a shop code; a shopper enters
            that code to see it. The grid below is the agent-readable catalog the assistant and any
            outside agent read from — one source of price, stock and margin.
          </p>
        </section>
        <ShopCodeGate />
      </StoreChrome>
    );
  }

  return (
    <StoreChrome>
      <ExitShop code={code ?? ""} />
      <h1 style={{ fontSize: 34 }}>The shop</h1>
      <p className="nl-sub" style={{ marginBottom: "var(--space-3)" }}>
        The shop is one module on the control plane. Agent-readable at{" "}
        <a href="/catalog.json">/catalog.json</a>.
      </p>

      <section className="nl-grid" aria-label="products">
        {sellable.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </section>

      {rest.length > 0 && (
        <section style={{ marginTop: "var(--space-4)" }}>
          <h2 style={{ fontFamily: "var(--serif)", fontWeight: 500 }}>Not available right now</h2>
          <p className="nl-sub" style={{ marginBottom: "var(--space-3)" }}>
            Listed for completeness. These are refused at the money path, not hidden from the feed.
          </p>
          <div className="nl-grid">
            {rest.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </StoreChrome>
  );
}
