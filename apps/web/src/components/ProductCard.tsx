import type { Product } from "@countersign/catalog";

import { Price } from "./Price";
import { ProductImage } from "./ProductImage";

/**
 * The shop's unit. The data-* attributes carry the same numbers the JSON feed
 * does, so an outside bot scraping the HTML and one reading /catalog.json can
 * never be shown different prices.
 */
export function ProductCard({ product }: { product: Product }) {
  const outOfStock = product.availability !== "in_stock" || product.stock_qty <= 0;

  return (
    <a
      className="nl-card"
      href={product.url}
      data-sku={product.id}
      data-price-paise={product.price_paise}
      data-availability={product.availability}
    >
      <ProductImage className="nl-thumb" src={product.image} alt={product.title} loading="lazy" />
      <h3>{product.title}</h3>
      <div className="nl-meta">
        <span className="nl-price">
          <Price paise={product.price_paise} />
        </span>
        {outOfStock ? (
          <span className="nl-oos">Out of stock</span>
        ) : (
          <span className="nl-sub">{product.attributes.size ?? ""}</span>
        )}
      </div>
      {product.blocked && <span className="nl-oos">Not sold through the agent channel</span>}
    </a>
  );
}
