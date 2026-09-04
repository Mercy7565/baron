"use client";

import { useState } from "react";

export function AddToCart({ skuId }: { skuId: string }) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  async function add(): Promise<void> {
    setBusy(true);
    try {
      await fetch("/api/cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add", sku_id: skuId }),
      });
      setAdded(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-actions">
      <button className="st-btn" disabled={busy} onClick={() => void add()}>
        {busy ? "Adding…" : "Add to cart"}
      </button>
      {added && (
        <a className="st-btn st-btn--quiet" href="/cart">
          Go to cart
        </a>
      )}
    </div>
  );
}
