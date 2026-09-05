"use client";

import { useCallback, useEffect, useState } from "react";

import { ShoppingBag } from "lucide-react";

import { Price } from "@/components/Price";
import { ShopAgent } from "@/components/ShopAgent";

interface PricedLine {
  sku_id: string;
  title: string;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
  /** A campaign gift: in the bag, shipped, never charged for. */
  gift?: boolean;
}

interface CartShape {
  lines: PricedLine[];
  amount_paise: number;
}

interface BagLine {
  sku_id: string;
  qty: number;
  gift?: boolean;
  title?: string;
}

/** A line the catalog no longer sells, named rather than silently vanished. */
interface DroppedLine {
  sku_id: string;
  title: string;
  reason: string;
}

interface Priced {
  quote_id: string | null;
  subtotal_paise: number;
  applied_bps: number;
  offer_id: string | null;
  legal_total_paise: number;
  reason: string | null;
}

const rupees = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;

/**
 * The basket, and the one card that says what it costs.
 *
 * Every change — add, quantity, remove — re-prices immediately, because a
 * basket that shows a stale total is worse than one that shows none. The price
 * comes from the same `/api/quotes` the money path uses, so what a shopper sees
 * here is what Generate will bill; nothing is priced in the browser.
 */
export function CartClient() {
  const [cart, setCart] = useState<CartShape | null>(null);
  const [priced, setPriced] = useState<Priced | null>(null);
  const [mandate, setMandate] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; fingerprint: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [dropped, setDropped] = useState<DroppedLine[]>([]);

  useEffect(() => {
    void fetch("/api/mandates/demo", { method: "POST" })
      .then((r) => r.json())
      .then((d: { mandate_hash: string }) => setMandate(d.mandate_hash));
  }, []);

  /** Re-read the basket and re-price it. Called after every mutation. */
  const refresh = useCallback(
    async (hash: string | null): Promise<void> => {
      const c = (await fetch("/api/cart").then((r) => r.json())) as {
        cart: CartShape;
        lines: BagLine[];
        dropped?: DroppedLine[];
      };

      // Named, not hidden. One retired sku used to blank the whole basket.
      setDropped(c.dropped ?? []);

      // The priced cart holds charged lines only; gifts come from the raw bag
      // so they can be shown at zero without ever entering the total.
      const gifts = (c.lines ?? []).filter((l) => l.gift === true);
      setCart({
        ...c.cart,
        lines: [
          ...c.cart.lines,
          ...gifts.map((g) => ({
            sku_id: g.sku_id,
            title: g.title ?? g.sku_id,
            qty: g.qty,
            unit_price_paise: 0,
            line_total_paise: 0,
            gift: true,
          })),
        ],
      });

      // M2: never show a Razorpay link whose amount is not the amount on
      // screen. The link is kept only while its bag is still the bag we have.
      const fp = c.cart.lines
        .filter((l) => l.qty > 0)
        .map((l) => `${l.sku_id}:${l.qty}`)
        .sort()
        .join("|");
      setLink((prev) => (prev !== null && prev.fingerprint === fp ? prev : null));

      if (c.cart.lines.length === 0 || hash === null) {
        setPriced(null);
        return;
      }

      const q = (await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyer_user_id: "demo",
          agent_id: "cart",
          mandate_hash: hash,
          sku_lines: c.cart.lines.map((l) => ({ sku_id: l.sku_id, qty: l.qty })),
        }),
      }).then((r) => r.json())) as Partial<Priced> & { quote_id?: string | null };

      setPriced({
        quote_id: q.quote_id ?? null,
        subtotal_paise: q.subtotal_paise ?? c.cart.amount_paise,
        applied_bps: q.applied_bps ?? 0,
        offer_id: q.offer_id ?? null,
        legal_total_paise: q.legal_total_paise ?? c.cart.amount_paise,
        reason: q.reason ?? null,
      });
    },
    [],
  );

  useEffect(() => {
    void refresh(mandate);
  }, [mandate, refresh]);

  async function mutate(action: "add" | "remove", sku: string, qty = 1): Promise<void> {
    setBusy(sku);
    setError(null);
    try {
      await fetch("/api/cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, sku_id: sku, qty }),
      });
      await refresh(mandate);
    } finally {
      setBusy(null);
    }
  }

  /**
   * One click. The server prices the basket it can see and makes the link for
   * that price, so the browser never holds a price that could go stale.
   */
  async function generate(): Promise<void> {
    setBusy("generate");
    setError(null);
    try {
      const res = await fetch("/api/checkout/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mandate_hash: mandate }),
      });
      const d = (await res.json()) as {
        short_url?: string;
        cart_fingerprint?: string;
        razorpay_error?: string;
        reason?: string;
        error?: string;
      };

      if (!res.ok || typeof d.short_url !== "string") {
        setError(String(d.razorpay_error ?? d.reason ?? d.error ?? "We could not create that link."));
        return;
      }
      // Remember which bag this link is for. If the bag changes, the link goes.
      setLink({ url: d.short_url, fingerprint: d.cart_fingerprint ?? "" });
    } finally {
      setBusy(null);
    }
  }

  if (cart === null) return <p className="st-muted">Loading your basket…</p>;

  if (cart.lines.length === 0) {
    return (
      <div className="st-empty">
        <ShoppingBag size={26} strokeWidth={1.5} aria-hidden />
        <p>Your basket is empty. Add something from the shop, or ask the assistant for it.</p>
        <div className="st-actions">
          <a className="st-btn" href="/shop">
            Browse the shop
          </a>
          <a className="st-btn st-btn--quiet" href="/agent">
            Ask the assistant
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="ct-wrap">
      <div className="cs-stack">
        {/* A line the shop stopped selling leaves the total but not the page.
            Blanking the whole basket over one of these was the old behaviour. */}
        {dropped.map((d) => (
          <div key={d.sku_id} className="st-note" style={{ borderColor: "var(--nl-rust)" }}>
            <strong>{d.title}</strong> was removed from your basket. {d.reason}
          </div>
        ))}
        {cart.lines.map((l) => (
          <div key={l.sku_id} className="st-card ct-line">
            <div>
              <div style={{ fontSize: 17 }}>{l.title}</div>
              <div className="st-muted" style={{ fontSize: 14, marginTop: 4 }}>
                {l.gift === true ? "Added free with your bag" : <><Price paise={l.unit_price_paise} /> each</>}
              </div>
            </div>

            {l.gift === true ? (
              <span className="ct-gift">Gift</span>
            ) : (
              <div className="ct-qty">
                <button
                  className="ct-step"
                  aria-label={`Remove one ${l.title}`}
                  disabled={busy !== null}
                  onClick={() => void mutate("add", l.sku_id, -1)}
                >
                  −
                </button>
                <span className="ct-count">{l.qty}</span>
                <button
                  className="ct-step"
                  aria-label={`Add one ${l.title}`}
                  disabled={busy !== null}
                  onClick={() => void mutate("add", l.sku_id, 1)}
                >
                  +
                </button>
              </div>
            )}

            <strong className="nl-money" style={{ fontSize: 17, minWidth: 96, textAlign: "right" }}>
              {l.gift === true ? "Free" : <Price paise={l.line_total_paise} />}
            </strong>

            <button
              className="ct-remove"
              disabled={busy !== null}
              onClick={() => void mutate("remove", l.sku_id)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* One card, this basket, nothing carried over from a previous one. */}
      <aside className="st-card ct-pay">
        <h2 style={{ fontSize: 19, marginTop: 0 }}>To pay</h2>

        <div className="ct-row">
          <span>Subtotal</span>
          <span className="nl-money">{rupees(priced?.subtotal_paise ?? cart.amount_paise)}</span>
        </div>

        <div className="ct-row">
          <span>
            Coupon
            {priced !== null && priced.applied_bps > 0 && (
              <span className="st-muted" style={{ fontSize: 13 }}>
                {" "}
                {priced.applied_bps / 100}%
              </span>
            )}
          </span>
          <span className="nl-money">
            {priced === null || priced.applied_bps === 0
              ? "—"
              : `− ${rupees(priced.subtotal_paise - priced.legal_total_paise)}`}
          </span>
        </div>

        <div className="ct-row ct-total">
          <strong>Total</strong>
          <strong className="nl-money">
            {rupees(priced?.legal_total_paise ?? cart.amount_paise)}
          </strong>
        </div>



        {error !== null && (
          <p className="st-note" style={{ marginTop: 0 }}>
            {error}
          </p>
        )}

        {link === null ? (
          <>
            <button
              className="st-btn"
              style={{ width: "100%" }}
              disabled={busy !== null}
              onClick={() => void generate()}
            >
              {busy === "generate" ? "One moment…" : error !== null ? "Try again" : "Pay now"}
            </button>
            <p className="st-muted" style={{ fontSize: 13, margin: "10px 0 0" }}>
              You will pay on Razorpay&rsquo;s secure page.
            </p>
          </>
        ) : (
          <>
            <a
              className="st-btn"
              style={{ width: "100%", textAlign: "center" }}
              href={link.url}
              target="_blank"
              rel="noreferrer"
            >
              Open your Razorpay link
            </a>
            <p className="st-muted mono" style={{ fontSize: 12, margin: "10px 0 0", wordBreak: "break-all" }}>
              {link.url}
            </p>
          </>
        )}

        <button
          className="st-btn st-btn--quiet"
          style={{ width: "100%", marginTop: 10 }}
          onClick={() => setDrawer((v) => !v)}
        >
          {drawer ? "Hide assistant" : "Ask the assistant"}
        </button>
      </aside>

      {drawer && (
        <section aria-label="assistant" style={{ gridColumn: "1 / -1" }}>
          <ShopAgent onCartChanged={() => void refresh(mandate)} />
        </section>
      )}
    </div>
  );
}
