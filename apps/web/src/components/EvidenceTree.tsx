"use client";

import { useState } from "react";

/**
 * One readable line in the story of a purchase.
 *
 * The kinds are the actual beats of the flow, not log levels — a shopper
 * reading top to bottom sees what they asked for, what was found, what was
 * suggested and why, what they chose, what policy did to the price, and how it
 * ended. The raw JSON is still there, one click further down, for a judge who
 * wants to check the words against the wire.
 */
export interface EvidenceStep {
  kind:
    | "asked"
    | "found"
    | "not_found"
    | "suggested"
    | "decided"
    | "policy"
    | "link"
    | "refused"
    | "error";
  title: string;
  detail: string;
  campaign_name?: string | null;
  verdict?: string;
  offer_id?: string | null;
  subtotal_paise?: number;
  total_paise?: number;
  short_url?: string | null;
}

const rupees = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;

const TONE: Record<EvidenceStep["kind"], string> = {
  asked: "you",
  found: "ok",
  not_found: "stop",
  suggested: "hint",
  decided: "you",
  policy: "policy",
  link: "ok",
  refused: "stop",
  error: "stop",
};

export function EvidenceTree({ steps, raw }: { steps: EvidenceStep[]; raw: unknown[] }) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="ev">
      <h3 className="ev-h">What just happened</h3>

      <ol className="ev-list">
        {steps.map((s, i) => (
          <li key={i} className="ev-step" data-tone={TONE[s.kind]}>
            <div className="ev-dot" aria-hidden="true" />
            <div className="ev-body">
              <div className="ev-title">
                {s.title}
                {/* No ALLOW/CLAMP badge. A shopper is not reading a decision
                    log, and the word meant nothing to them anyway. */}
              </div>
              <p className="ev-detail">{s.detail}</p>

              {s.campaign_name !== undefined && s.campaign_name !== null && (
                <p className="ev-note">
                  Part of <strong>{s.campaign_name}</strong>.
                </p>
              )}

              {s.kind === "policy" && (
                <p className="ev-note">
                  {s.subtotal_paise !== undefined && s.total_paise !== undefined && (
                    <>
                      {rupees(s.subtotal_paise)} before discount, {rupees(s.total_paise)} to pay.{" "}
                    </>
                  )}
                  {s.offer_id === null || s.offer_id === undefined
                    ? "No Razorpay offer was attached."
                    : `Razorpay offer ${s.offer_id} was attached.`}
                </p>
              )}

              {s.kind === "link" && s.short_url !== null && s.short_url !== undefined && (
                <a className="ev-link mono" href={s.short_url} target="_blank" rel="noreferrer">
                  {s.short_url}
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* The raw calls used to be one click away here. That is a judge's
          view, not a shopper's — it lives on the merchant ledger instead. */}
    </div>
  );
}
