"use client";

import { useEffect, useState } from "react";

/**
 * The Cart link, with a live item count.
 *
 * The cart lives on the server, so the badge has to ask for it. It refreshes on
 * mount and whenever the tab regains focus — enough for a shopper who added
 * something from a product page and came back, without polling the route on a
 * timer for a number that only changes when they act.
 */
export function CartNavLink() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;

    const load = (): void => {
      void fetch("/api/cart")
        .then((r) => r.json())
        .then((d: { cart?: { lines?: Array<{ qty: number }> } }) => {
          if (!alive) return;
          const lines = d.cart?.lines ?? [];
          setCount(lines.reduce((n, l) => n + l.qty, 0));
        })
        .catch(() => {
          /* a missing count is not worth an error in the nav */
        });
    };

    load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, []);

  return (
    <a href="/cart" className="st-cart">
      Cart
      {count !== null && count > 0 && (
        <span className="st-cart-badge" aria-label={`${count} items in cart`}>
          {count}
        </span>
      )}
    </a>
  );
}
