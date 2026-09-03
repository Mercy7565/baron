"use client";

import { useState } from "react";

/**
 * List a new product from the console.
 *
 * Overlay only: the shipped catalog file is never rewritten, so a typo here
 * cannot destroy the seed data the demo runs on. The product appears on /shop
 * on the next request, and is priced, guarded and recommended exactly like a
 * shipped one.
 */
export function AddProduct() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("50");
  const [margin, setMargin] = useState("50");
  const [onSale, setOnSale] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [image, setImage] = useState("");

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/merchant/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          id: sku.trim(),
          price_paise: Math.round(Number(price) * 100),
          stock_qty: Number(stock),
          margin_bps: Math.round(Number(margin) * 100),
          on_sale: onSale,
          blocked,
          image: image.trim(),
        }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(d.error ?? "could not add that product");
        return;
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="mc-btn" style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
        Add product
      </button>
    );
  }

  return (
    <div className="mc-panel" style={{ marginBottom: 12 }}>
      <h2>Add product</h2>

      <div className="mc-form">
        <label>
          <span>Name</span>
          <input className="mc-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          <span>SKU (blank to generate)</span>
          <input
            className="mc-input"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="sku_…"
          />
        </label>
        <label>
          <span>Price ₹</span>
          <input
            className="mc-input"
            type="number"
            min={1}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label>
          <span>Stock</span>
          <input
            className="mc-input"
            type="number"
            min={0}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
          />
        </label>
        <label>
          <span>Margin %</span>
          <input
            className="mc-input"
            type="number"
            min={0}
            max={100}
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
          />
        </label>
        <label className="mc-form-wide">
          <span>Image URL — leave blank for a placeholder</span>
          <input
            className="mc-input"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="/catalog/my-product.png"
          />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={onSale} onChange={(e) => setOnSale(e.target.checked)} />
          <span>On sale</span>
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />
          <span>Blocked from the agent channel</span>
        </label>
      </div>

      {error !== null && (
        <p className="mc-sub" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <p className="mc-sub">
        Margin decides which coupons this product can carry. A low-margin product will reach a
        smaller coupon, because the floor binds first.
      </p>

      <div className="cs-row" style={{ gap: 8 }}>
        <button className="mc-btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Add to catalog"}
        </button>
        <button className="mc-btn mc-btn--quiet" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
