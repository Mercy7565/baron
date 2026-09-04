import { Store } from "lucide-react";

/**
 * The bar naming which shop you are standing in.
 *
 * The way out lives in the nav, on every page, so this no longer carries a
 * button of its own — two Exit controls on one screen is one more than a
 * shopper needs. What the nav cannot say is *which* shop, and that is the
 * whole job of this bar: a platform with one visible catalog should still
 * name the catalog.
 */
export function ExitShop({ code }: { code: string }) {
  return (
    <div className="sc-bar">
      <Store size={17} strokeWidth={1.75} aria-hidden />
      <span className="st-muted">
        You are shopping <strong className="mono">{code}</strong>
      </span>
    </div>
  );
}
