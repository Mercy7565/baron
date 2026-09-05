import { ProductCard } from "@/components/ProductCard";
import { CATALOG } from "@/lib/catalog";

import { StoreChrome } from "@/components/StoreChrome";
import { enteredCode, unlockedTenant } from "@/server/shop-code";

import { ExitShop } from "./ExitShop";
import { ShopCodeGate } from "./ShopCodeGate";
import { hydrateOverlay } from "@/server/overlay";

export const dynamic = "force-dynamic";

export default async function ShopPage() {
  // Merchant state is durable and shared; pull it into this instance
  // before anything reads a campaign, a catalog edit or the margin floor.
  await hydrateOverlay();

  const sellable = CATALOG.products.filter((p) => !p.blocked && p.availability === "in_stock");
  const rest = CATALOG.products.filter((p) => p.blocked || p.availability !== "in_stock");

  const tenant = await unlockedTenant();
  const code = await enteredCode();

  if (tenant === null) {
    return (
      <StoreChrome>
        <h1>Shop</h1>
        <p className="page-help">
          Each merchant on Baron has its own shop code. Enter the one you were given to see their
          products. The assistant can only search the shop you are in.
        </p>
        <ShopCodeGate />
      </StoreChrome>
    );
  }

  return (
    <StoreChrome>
      <ExitShop code={code ?? ""} />
      <h1>The shop</h1>
      <p className="st-lede">
        The shop is one module on the control plane. Agent-readable at{" "}
        <a href="/catalog.json">/catalog.json</a>.
      </p>

      <section className="nl-grid" aria-label="products">
        {sellable.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </section>

      {rest.length > 0 && (
        <section style={{ marginTop: 44 }}>
          <h2>Not available right now</h2>
          <p className="st-muted" style={{ marginBottom: 20 }}>
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
