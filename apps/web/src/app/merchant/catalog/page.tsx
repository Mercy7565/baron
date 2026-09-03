import { ConsoleChrome } from "@/components/ConsoleChrome";
import { CATALOG } from "@/lib/catalog";

import { CatalogEditor } from "./CatalogEditor";
import { AddProduct } from "./AddProduct";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function MerchantCatalog() {
  return (
    <ConsoleChrome current="/merchant/catalog">
      <h1>Catalog</h1>
      <p className="mc-sub">
        Price, stock and availability as the store currently sells them. Edits are kept as an
        overlay, so the shipped catalog file is never destroyed.
      </p>

      <AddProduct />
      <CatalogEditor products={CATALOG.products} />
    </ConsoleChrome>
  );
}
