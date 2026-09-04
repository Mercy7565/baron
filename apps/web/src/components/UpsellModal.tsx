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

        <div className="up-body">
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
            <p className="st-muted" style={{ margin: 0 }}>
              {suggestion.title} · {suggestion.gift === true ? "Free" : `₹${(suggestion.price_paise / 100).toFixed(2)}`}
            </p>
          </div>
        </div>

        <p className="st-muted" style={{ marginTop: 16 }}>
          Your coupon is worked out from your whole bag at checkout.
        </p>

        <div className="st-actions" style={{ marginTop: 16 }}>
          <button className="st-btn" disabled={busy} onClick={onAccept}>
            Accept
          </button>
          <button className="st-btn st-btn--quiet" disabled={busy} onClick={onReject}>
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
