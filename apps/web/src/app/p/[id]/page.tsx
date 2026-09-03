import { notFound } from "next/navigation";

import { productById } from "@countersign/catalog";

import { AddToCart } from "@/components/AddToCart";
import { Price } from "@/components/Price";
import { ProductCard } from "@/components/ProductCard";
import { CATALOG, baseUrl } from "@/lib/catalog";
import { ProductImage } from "@/components/ProductImage";

export const dynamic = "force-dynamic";

/**
 * The human PDP and the machine PDP are the same page: the JSON-LD block is
 * generated from the same catalog record the visible markup renders, so a
 * crawler and a shopper cannot be shown different prices.
 */
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = productById(CATALOG, id);
  if (product === null) notFound();

  const alsoBought = product.frequently_bought_with
    .map((rid) => productById(CATALOG, rid))
    .filter((p): p is NonNullable<typeof p> => p !== null && !p.blocked)
    .slice(0, 4);

  const outOfStock = product.availability !== "in_stock" || product.stock_qty <= 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${baseUrl()}${product.url}`,
    sku: product.id,
    name: product.title,
    description: product.description,
    brand: { "@type": "Brand", name: product.brand },
    category: product.category.join(" > "),
    image: product.image,
    additionalProperty: Object.entries(product.attributes).map(([name, value]) => ({
      "@type": "PropertyValue",
      name,
      value,
    })),
    offers: {
      "@type": "Offer",
      url: `${baseUrl()}${product.url}`,
      priceCurrency: product.currency,
      price: (product.price_paise / 100).toFixed(2),
      availability: outOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      eligibleQuantity: {
        "@type": "QuantitativeValue",
        maxValue: product.max_qty,
        unitCode: "C62",
      },
    },
  };

  return (
    <main className="nl-shell" style={{ paddingTop: "var(--space-4)" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <article
        className="nl-pdp"
        data-sku={product.id}
        data-price-paise={product.price_paise}
        data-availability={product.availability}
      >
        <ProductImage src={product.image} alt={product.title} loading="eager" />

        <div>
          <p className="nl-sub" style={{ marginTop: 0 }}>
            {product.brand} · {product.category.join(" / ")}
          </p>
          <h1>{product.title}</h1>

          <p style={{ fontSize: 22, margin: "0 0 var(--space-2)" }}>
            <Price paise={product.price_paise} />
          </p>

          <p style={{ maxWidth: "46ch" }}>{product.description}</p>

          {product.blocked ? (
            <div className="nl-note">
              This product is on the policy denylist and cannot be sold through the agent channel.
              Adding it to a basket produces a REJECT, and no order is created.
            </div>
          ) : outOfStock ? (
            <div className="nl-note">Out of stock. An out-of-stock line cannot become an order.</div>
          ) : (
            <AddToCart skuId={product.id} />
          )}

          <dl
            style={{
              marginTop: "var(--space-3)",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "6px var(--space-2)",
              fontSize: 14,
            }}
          >
            {Object.entries(product.attributes).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt className="nl-sub">{k}</dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
            <dt className="nl-sub">max per order</dt>
            <dd style={{ margin: 0 }}>{product.max_qty}</dd>
          </dl>

          <p className="nl-sub" style={{ marginTop: "var(--space-3)" }}>
            Machine view: <a href={`/api/catalog/lookup?ids=${product.id}`}>lookup JSON</a>
          </p>
        </div>
      </article>

      {alsoBought.length > 0 && (
        <section style={{ marginTop: "var(--space-4)" }}>
          <h2 style={{ fontFamily: "var(--serif)", fontWeight: 500 }}>Frequently bought with</h2>
          <p className="nl-sub" style={{ marginBottom: "var(--space-3)" }}>
            The only products the agent may suggest from this page.
          </p>
          <div className="nl-grid">
            {alsoBought.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
