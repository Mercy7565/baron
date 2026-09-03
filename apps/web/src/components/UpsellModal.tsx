"use client";

import { ProductImage } from "./ProductImage";

export interface Suggestion {
  sku_id: string;
  title: string;
  price_paise: number;
  image?: string;
  extra_bps: number;
  message?: string;
  /** The recommender's computed sentence — real numbers, not a hope. */
  reason: string;
  gift?: boolean;
  campaign_id?: string | null;
}

/**
 * An upsell is proposed, never applied. Nothing is added to the basket until
 * the shopper says yes — that consent is the difference between a nudge and an
 * agent spending someone's money for them.
 */
export function UpsellModal({
  suggestion,
  onAccept,
  onReject,
  busy,
}: {
  suggestion: Suggestion;
  onAccept: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  return (
    <div className="nl-modal-backdrop" role="dialog" aria-modal="true" aria-label="Suggestion">
      <div className="nl-modal">
        <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 21, marginTop: 0 }}>
          Save more
        </h3>

        <div className="cs-row" style={{ gap: "var(--space-2)", alignItems: "flex-start" }}>
          {suggestion.image !== undefined && (
            <ProductImage
              src={suggestion.image}
              alt=""
              className="nl-upsell-thumb"
              loading="eager"
            />
          )}
          <div>
            <p style={{ margin: "0 0 6px" }}>{suggestion.reason}</p>
            <p className="nl-sub" style={{ margin: 0 }}>
              {suggestion.title} · {suggestion.gift === true ? "Free" : `₹${(suggestion.price_paise / 100).toFixed(2)}`}
            </p>
          </div>
        </div>

        <p className="nl-sub" style={{ marginTop: "var(--space-2)" }}>
          Your coupon is worked out from your whole bag at checkout.
        </p>

        <div className="cs-row" style={{ marginTop: "var(--space-2)", gap: "var(--space)" }}>
          <button className="nl-btn" disabled={busy} onClick={onAccept}>
            Accept
          </button>
          <button className="nl-btn nl-btn--ghost" disabled={busy} onClick={onReject}>
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
