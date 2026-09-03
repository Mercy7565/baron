/**
 * @countersign/catalog
 *
 * The agent-readable catalog. This is what an outside bot traverses instead of
 * scraping HTML, and it is the only source of truth for price, stock and
 * margin. Nothing here talks to a payment provider.
 *
 * Every function is pure over an injected catalog, so the same code serves the
 * HTTP endpoints, the in-app agent, and the tests.
 */

export const CATALOG_PACKAGE_VERSION = "0.1.0" as const;

export type Availability = "in_stock" | "oos";

export interface Product {
  id: string;
  title: string;
  description: string;
  brand: string;
  category: string[];
  url: string;
  price_paise: number;
  currency: "INR";
  availability: Availability;
  stock_qty: number;
  max_qty: number;
  margin_bps: number;
  attributes: Record<string, string>;
  complements: string[];
  upgrades: string[];
  /** Curated co-purchase edges. The recommender may use nothing else. */
  frequently_bought_with: string[];
  blocked: boolean;
  image: string;
}

export interface Catalog {
  vertical: string;
  currency: "INR";
  catalog_version: string;
  products: Product[];
}

// --------------------------------------------------------------- lookup/search

export function productById(catalog: Catalog, id: string): Product | null {
  for (const p of catalog.products) {
    if (p.id === id) return p;
  }
  return null;
}

/** Only ever returns products that exist in the catalog. */
export function lookupSkus(catalog: Catalog, ids: string[]): Product[] {
  const out: Product[] = [];
  for (const id of ids) {
    const p = productById(catalog, id);
    if (p !== null && !out.includes(p)) out.push(p);
  }
  return out;
}

function scoreMatch(p: Product, terms: string[]): number {
  const title = p.title.toLowerCase();
  const desc = p.description.toLowerCase();
  const cats = p.category.join(" ").toLowerCase();
  const attrs = Object.values(p.attributes).join(" ").toLowerCase();

  let score = 0;
  for (const t of terms) {
    if (title.includes(t)) score += 4;
    if (cats.includes(t)) score += 3;
    if (attrs.includes(t)) score += 2;
    if (desc.includes(t)) score += 1;
  }
  return score;
}

/**
 * Deliberately boring substring scoring. An agent needs a deterministic,
 * explainable result far more than it needs fuzzy relevance.
 */
export function searchCatalog(catalog: Catalog, query: string, limit = 10): Product[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== "");

  if (terms.length === 0) return catalog.products.slice(0, limit);

  const scored: Array<{ p: Product; score: number }> = [];
  for (const p of catalog.products) {
    const score = scoreMatch(p, terms);
    if (score > 0) scored.push({ p, score });
  }

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.p.id < b.p.id ? -1 : 1));
  return scored.slice(0, limit).map((s) => s.p);
}

// ------------------------------------------------------------------ cart maths

export interface CartLine {
  sku_id: string;
  qty: number;
}

export interface PricedLine {
  sku_id: string;
  title: string;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
  margin_bps: number;
}

export interface PricedCart {
  lines: PricedLine[];
  amount_paise: number;
  /** Cart-level margin, weighted by line value. Integer bps, floored. */
  margin_bps: number;
  product_ids: string[];
}

/**
 * Price a cart from the catalog. The agent never supplies prices — whatever it
 * said in conversation is irrelevant here, which is what makes price_drift
 * unable to move money.
 */
export function priceCart(catalog: Catalog, lines: CartLine[]): PricedCart {
  const priced: PricedLine[] = [];
  let amount = 0;
  let marginWeighted = 0;

  for (const line of lines) {
    const p = productById(catalog, line.sku_id);
    if (p === null) continue;

    const lineTotal = p.price_paise * line.qty;
    priced.push({
      sku_id: p.id,
      title: p.title,
      qty: line.qty,
      unit_price_paise: p.price_paise,
      line_total_paise: lineTotal,
      margin_bps: p.margin_bps,
    });
    amount += lineTotal;
    marginWeighted += p.margin_bps * lineTotal;
  }

  return {
    lines: priced,
    amount_paise: amount,
    margin_bps: amount === 0 ? 0 : Math.floor(marginWeighted / amount),
    product_ids: priced.map((l) => l.sku_id),
  };
}

// -------------------------------------------------------------- recommendations

/**
 * Candidate upsells and cross-sells drawn only from the catalog's own
 * `upgrades` and `complements`. The agent cannot invent a product to recommend.
 */
export function recommendationCandidates(catalog: Catalog, cart: CartLine[]): Product[] {
  const inCart = new Set(cart.map((l) => l.sku_id));
  const seen = new Set<string>();
  const out: Product[] = [];

  for (const line of cart) {
    const p = productById(catalog, line.sku_id);
    if (p === null) continue;

    for (const id of [...p.upgrades, ...p.complements, ...(p.frequently_bought_with ?? [])]) {
      if (inCart.has(id) || seen.has(id)) continue;
      const rec = productById(catalog, id);
      if (rec === null) continue;
      if (rec.blocked || rec.availability !== "in_stock") continue;
      seen.add(id);
      out.push(rec);
    }
  }

  return out;
}
