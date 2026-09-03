import { ProductCard } from "@/components/ProductCard";
import { CATALOG } from "@/lib/catalog";

import { StoreChrome } from "@/components/StoreChrome";

export const dynamic = "force-dynamic";

export default function ShopPage() {
  const sellable = CATALOG.products.filter((p) => !p.blocked && p.availability === "in_stock");
  const rest = CATALOG.products.filter((p) => p.blocked || p.availability !== "in_stock");

  return (
    <StoreChrome>
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
