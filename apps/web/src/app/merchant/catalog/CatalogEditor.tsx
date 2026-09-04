"use client";

import { useState } from "react";

import type { Product } from "@countersign/catalog";

interface Draft {
  price_paise: number;
  stock_qty: number;
  blocked: boolean;
  active: boolean;
}

/**
 * The catalog table.
 *
 * Edits are written to an overlay, never back into the shipped catalog file, so
 * a merchant cannot destroy the seed data the rest of the demo depends on.
 */
export function CatalogEditor({ products }: { products: Product[] }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      products.map((p) => [
        p.id,
        {
          price_paise: p.price_paise,
          stock_qty: p.stock_qty,
          blocked: p.blocked,
          active: p.availability === "in_stock",
        },
      ]),
    ),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  function edit(id: string, patch: Partial<Draft>): void {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] as Draft), ...patch } }));
  }

  async function save(id: string): Promise<void> {
    setSaving(id);
    try {
      await fetch("/api/merchant/catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku_id: id, ...drafts[id] }),
      });
      setSaved(id);
      window.setTimeout(() => setSaved(null), 1800);
    } finally {
      setSaving(null);
    }
  }

  /**
   * Take a product off the shop.
   *
   * `active: false` rather than a delete: the row leaves /shop and the SKU
   * count, but the product still exists, so a paid order that contains it can
   * still name it. Deleting the record would rewrite history a customer already
   * paid for. Put it back by ticking On sale.
   */
  async function remove(id: string): Promise<void> {
    setSaving(id);
    try {
      await fetch("/api/merchant/catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku_id: id, ...drafts[id], active: false, stock_qty: 0 }),
      });
      window.location.reload();
    } finally {
      setSaving(null);
      setConfirming(null);
    }
  }

  return (
    <div className="mc-panel">
      <table className="mc-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Product</th>
            <th className="num">Price (paise)</th>
            <th className="num">Stock</th>
            <th className="num">Margin</th>
            <th>On sale</th>
            <th>Blocked</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const d = drafts[p.id] as Draft;
            const dirty =
              d.price_paise !== p.price_paise ||
              d.stock_qty !== p.stock_qty ||
              d.blocked !== p.blocked ||
              d.active !== (p.availability === "in_stock");

            return (
              <tr key={p.id}>
                <td style={{ color: "var(--muted)" }}>{p.id}</td>
                <td>{p.title}</td>
                <td className="num" style={{ width: 120 }}>
                  <input
                    className="mc-input"
                    style={{ textAlign: "right" }}
                    value={d.price_paise}
                    inputMode="numeric"
                    onChange={(e) => edit(p.id, { price_paise: Number(e.target.value) || 0 })}
                  />
                </td>
                <td className="num" style={{ width: 86 }}>
                  <input
                    className="mc-input"
                    style={{ textAlign: "right" }}
                    value={d.stock_qty}
                    inputMode="numeric"
                    onChange={(e) => edit(p.id, { stock_qty: Number(e.target.value) || 0 })}
                  />
                </td>
                <td className="num" style={{ color: "var(--muted)" }}>
                  {p.margin_bps / 100}%
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={d.active}
                    onChange={(e) => edit(p.id, { active: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={d.blocked}
                    onChange={(e) => edit(p.id, { blocked: e.target.checked })}
                  />
                </td>
                <td>
                  {confirming === p.id ? (
                    <div className="cs-row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <span className="mc-tiny">Take off the shop?</span>
                      <button
                        className="mc-btn"
                        disabled={saving === p.id}
                        onClick={() => void remove(p.id)}
                      >
                        {saving === p.id ? "…" : "Yes"}
                      </button>
                      <button className="mc-btn mc-btn--quiet" onClick={() => setConfirming(null)}>
                        No
                      </button>
                    </div>
                  ) : (
                    <div className="cs-row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <button
                        className="mc-btn"
                        disabled={!dirty || saving === p.id}
                        onClick={() => void save(p.id)}
                      >
                        {saving === p.id ? "…" : saved === p.id ? "Saved" : "Save"}
                      </button>
                      {p.availability === "in_stock" && !p.blocked && (
                        <button
                          className="mc-btn mc-btn--quiet"
                          onClick={() => setConfirming(p.id)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
