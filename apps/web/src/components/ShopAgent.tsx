"use client";

import { useEffect, useState } from "react";

import { EvidenceTree, type EvidenceStep } from "./EvidenceTree";
import { UpsellModal, type Suggestion } from "./UpsellModal";

interface Line {
  role: "you" | "agent" | "system";
  text: string;
}

interface QuoteState {
  quote_id: string;
  legal_total_paise: number;
  subtotal_paise: number;
  asked_bps: number;
  applied_bps: number;
  offer_id: string | null;
  verdict: string;
  campaign_id: string | null;
  campaign_name: string | null;
  reason: string | null;
  /** The guard's own mistake code, when a basket or a line was refused. */
  reason_code: string | null;
  /** Lines dropped so the rest of the basket could still be priced. */
  refused_skus: Array<{ sku_id: string; code: string; message: string }>;
  ignored_inputs: string[];
}

const rupees = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;

/**
 * The shopper-facing agent.
 *
 * Everything money-shaped it does is a call to a server route: it never prices
 * anything itself, never picks an offer, and never sees a card. The transcript
 * below is the whole point — a shopper can read exactly what it did.
 *
 * The shopper's last decision is Accept or Reject on the upsell. That tap
 * quotes, approves and issues the Payment Link in one go; when there is no
 * upsell to ask about, the link is issued as soon as the total is legal. There
 * is no second "now issue it" button in the happy path — only a retry that
 * appears if issuing actually failed.
 */
export function ShopAgent({ onCartChanged }: { onCartChanged?: () => void } = {}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mandate, setMandate] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [paid, setPaid] = useState<Record<string, unknown> | null>(null);
  const [issueFailed, setIssueFailed] = useState(false);
  const [lastIntent, setLastIntent] = useState<string | null>(null);
  const [steps, setSteps] = useState<EvidenceStep[]>([]);
  const [raw, setRaw] = useState<unknown[]>([]);

  useEffect(() => {
    void fetch("/api/mandates/demo", { method: "POST" })
      .then((r) => r.json())
      .then((d: { mandate_hash: string }) => setMandate(d.mandate_hash));
  }, []);

  const say = (role: Line["role"], text: string): void => {
    setLines((l) => [...l, { role, text }]);
  };

  const step = (s: EvidenceStep): void => {
    setSteps((all) => [...all, s]);
  };

  async function quoteCart(
    note: string,
    intentText: string | null = null,
    upsellAccepted: boolean | null = null,
  ): Promise<QuoteState | null> {
    const cartRes = await fetch("/api/cart");
    const cart = (await cartRes.json()) as {
      // `cart.lines` is the priced bag: gifts are already excluded from it,
      // which is why quoting from it alone silently dropped every gift.
      cart: { lines: Array<{ sku_id: string; qty: number }> };
      lines: Array<{ sku_id: string; qty: number; gift?: boolean; from_campaign_id?: string }>;
    };

    const bag = cart.lines ?? [];

    const r = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        buyer_user_id: "demo",
        agent_id: "shop_agent",
        mandate_hash: mandate,
        // Recorded so the merchant's ledger can show what was actually asked
        // for, in the shopper's own words, next to what policy allowed.
        intent_text: intentText,
        upsell_accepted: upsellAccepted,
        sku_lines: bag
          .filter((l) => l.gift !== true)
          .map((l) => ({
            sku_id: l.sku_id,
            qty: l.qty,
            ...(l.from_campaign_id === undefined ? {} : { from_campaign_id: l.from_campaign_id }),
          })),
        // Gifts travel beside the priced lines so the quote — and therefore the
        // order and the burn — records what the campaign actually gave away.
        gift_lines: bag
          .filter((l) => l.gift === true)
          .map((l) => ({
            sku_id: l.sku_id,
            qty: l.qty,
            from_campaign_id: l.from_campaign_id ?? null,
          })),
        // No figure on purpose. The server asks for the best coupon this
        // basket can clear, so the answer is an ALLOW rather than a CLAMP
        // against a 15% nobody requested.
      }),
    });

    const d = (await r.json()) as Partial<QuoteState> & { quote_id?: string | null };
    setRaw((e) => [...e, { step: "quote", note, response: d }]);

    if (d.quote_id == null) {
      // Say what actually stopped it. "Policy refused that basket" named no
      // cause and gave a shopper nothing to act on; the route now returns the
      // real mistake code and the guard's own sentence.
      const why = d.reason ?? "I could not price that bag.";
      const code = d.reason_code ?? null;
      say("agent", why);
      step({
        kind: "refused",
        title:
          code === "blocked_sku"
            ? "We do not sell that one here"
            : code === "oos"
              ? "That product is out of stock"
              : code === "sku_hallucinated"
                ? "That product is not in the catalog"
                : "I could not price that bag",
        detail: why,
      });
      return null;
    }

    // Lines dropped so the rest of the basket could be priced.
    for (const refused of d.refused_skus ?? []) {
      say("agent", `I could not add that one — ${refused.message.toLowerCase()}`);
      step({
        kind: "refused",
        title: "One item was left out",
        detail: `${refused.message} Everything else in your bag is still priced normally.`,
      });
    }

    const q: QuoteState = {
      quote_id: d.quote_id,
      legal_total_paise: d.legal_total_paise ?? 0,
      subtotal_paise: d.subtotal_paise ?? 0,
      asked_bps: d.asked_bps ?? 1500,
      applied_bps: d.applied_bps ?? 0,
      offer_id: d.offer_id ?? null,
      verdict: d.verdict ?? "",
      campaign_id: d.campaign_id ?? null,
      campaign_name: d.campaign_name ?? null,
      reason: d.reason ?? null,
      reason_code: d.reason_code ?? null,
      refused_skus: d.refused_skus ?? [],
      ignored_inputs: d.ignored_inputs ?? [],
    };
    setQuote(q);
    say(
      "agent",
      q.applied_bps === 0
        ? `Your bag comes to ${rupees(q.legal_total_paise)}. No coupon applies to it yet.`
        : `Your bag comes to ${rupees(q.legal_total_paise)}, with ${q.applied_bps / 100}% off applied.`,
    );
    step({
      kind: "policy",
      title:
        q.applied_bps === 0
          ? "No coupon on this bag yet"
          : `${q.applied_bps / 100}% off applied`,
      detail:
        q.applied_bps === 0
          ? "Add a little more and a coupon becomes available."
          : "This is the best coupon your bag qualifies for right now.",
      verdict: q.verdict,
      offer_id: q.offer_id,
      subtotal_paise: q.subtotal_paise,
      total_paise: q.legal_total_paise,
    });
    return q;
  }

  async function handle(text: string): Promise<void> {
    if (text.trim() === "" || busy) return;
    setBusy(true);
    say("you", text);
    setInput("");
    setPaid(null);
    setIssueFailed(false);
    setLastIntent(text);
    step({ kind: "asked", title: "You asked", detail: text });

    try {
      const buyMatch = /buy me (?:the |a |some )?(.+?)(?:[.!?]|$)/i.exec(text);
      if (buyMatch !== null) {
        const query = (buyMatch[1] ?? "").trim();
        // Not /api/catalog/search: that ranks everything and always answers
        // with its best guess, so "unicorn cream" came back as eye cream. This
        // endpoint applies a confidence bar and returns nothing when nothing
        // really matches.
        const sr = await fetch(`/api/agent/resolve?q=${encodeURIComponent(query)}`);
        const sd = (await sr.json()) as { match: { id: string; title: string } | null };
        const hit = sd.match ?? undefined;
        setRaw((e) => [...e, { step: "resolve", query, match: sd.match }]);

        if (hit === undefined) {
          // No near-match substitution, ever.
          say("agent", "I could not find that product, so I am not adding anything.");
          step({
            kind: "not_found",
            title: "Not found in the catalog",
            detail: `Nothing matched "${query}" confidently enough to spend money on, so nothing was added and no link exists.`,
          });
          return;
        }

        say("agent", `Found ${hit.id} — ${hit.title}. Adding it to your basket.`);
        step({ kind: "found", title: "Found", detail: `${hit.title} (${hit.id})` });

        await fetch("/api/cart", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "add", sku_id: hit.id }),
        });
        // The basket card owns the price, so tell it the basket moved.
        onCartChanged?.();

        const nr = await fetch("/api/agent/notify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        const nd = (await nr.json()) as { suggestion: Suggestion | null; campaign_name?: string };
        setRaw((e) => [...e, { step: "notify", response: nd }]);

        if (nd.suggestion !== null) {
          say("agent", `Suggested: ${nd.suggestion.title}.`);
          step({
            kind: "suggested",
            title: "Suggested",
            // The recommender's own sentence, which was computed by running the
            // kernel over the resulting basket. Never a percentage we hope for.
            detail: nd.suggestion.reason,
            campaign_name: nd.campaign_name ?? null,
          });
          setSuggestion(nd.suggestion);
          return; // wait for the shopper — Accept or Reject is the last tap
        }

        // Nothing to ask about. Quote it and stop — the link is the human's
        // call, not ours.
        await quoteCart("no upsell offered", text, null);
        return;
      }

      say("agent", 'Try "buy me the niacinamide".');
    } finally {
      setBusy(false);
    }
  }

  async function accept(): Promise<void> {
    if (suggestion === null) return;
    setBusy(true);
    try {
      await fetch("/api/cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          sku_id: suggestion.sku_id,
          // A gift goes in flagged. The money path filters it out, so accepting
          // one cannot change what is owed.
          // A gift is never charged for; an accepted paid suggestion is, but
          // both spend the campaign's budget, so both carry its id.
          ...(suggestion.campaign_id == null
            ? {}
            : suggestion.gift === true
              ? { gift_campaign_id: suggestion.campaign_id }
              : { from_campaign_id: suggestion.campaign_id }),
        }),
      });
      onCartChanged?.();
      say("you", suggestion.gift === true ? `Yes, add the free ${suggestion.title}.` : `Yes, add ${suggestion.title}.`);
      step({ kind: "decided", title: "You accepted", detail: `Added ${suggestion.title}.` });
      setSuggestion(null);
      await quoteCart("upsell accepted", lastIntent, true);
    } finally {
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    if (suggestion === null) return;
    setBusy(true);
    try {
      say("you", "Rejected the suggestion.");
      step({
        kind: "decided",
        title: "You rejected",
        detail: "The basket was quoted exactly as it stood.",
      });
      setSuggestion(null);
      await quoteCart("upsell rejected", lastIntent, false);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Approve the quote and generate the Payment Link.
   *
   * Only ever called from the shopper's own click. Nothing on the agent path
   * creates a link on its own any more: quoting is free and reversible, but a
   * Payment Link is a real object in a real Razorpay account, and creating one
   * because a model finished a sentence is not the shopper asking to pay.
   */
  async function finish(q: QuoteState): Promise<void> {
    setIssueFailed(false);
    await fetch(`/api/quotes/${q.quote_id}/approve`, { method: "POST" });

    const r = await fetch("/api/checkout/issue-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quote_id: q.quote_id, mandate_hash: mandate, presence: "agent" }),
    });
    const d = (await r.json()) as Record<string, unknown>;
    setRaw((e) => [...e, { step: "issue_link", response: d }]);

    if (r.status !== 200) {
      // Never invent a link. Say what Razorpay or policy said, and leave the
      // retry button as the only way forward.
      const why = String(d.razorpay_error ?? d.reason ?? d.error ?? "unknown error");
      say("agent", `Could not issue a payment link: ${why}.`);
      step({ kind: "error", title: "No link was issued", detail: why });
      setIssueFailed(true);
      return;
    }

    setPaid(d);
    say("agent", "Order ready. Pay link issued.");
    
    step({
      kind: "link",
      title: "Payment link issued",
      detail: `${rupees(q.legal_total_paise)} — you pay on Razorpay's secure page.`,
      short_url: typeof d.short_url === "string" ? d.short_url : null,
    });
  }

  return (
    <>
      {suggestion !== null && (
        <UpsellModal
          suggestion={suggestion}
          busy={busy}
          onAccept={() => void accept()}
          onReject={() => void reject()}
        />
      )}

      <div className="nl-panel cs-stack">
        <div className="cs-row" style={{ flexWrap: "wrap" }}>
          {["buy me the niacinamide", "buy me the invisible sunscreen"].map((s) => (
            <button
              key={s}
              className="nl-btn nl-btn--ghost"
              style={{ fontSize: 13, padding: "6px 14px" }}
              disabled={busy}
              onClick={() => void handle(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <form
          className="cs-row"
          onSubmit={(e) => {
            e.preventDefault();
            void handle(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="tell the agent what you want"
            style={{
              flex: 1,
              font: "inherit",
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius)",
            }}
          />
          <button className="nl-btn" disabled={busy} type="submit">
            {busy ? "…" : "Send"}
          </button>
        </form>

        <div className="cs-stack" role="log" aria-label="agent transcript" style={{ gap: 6 }}>
          {lines.map((l, i) => (
            <div key={i} data-role={l.role} style={{ fontSize: 15 }}>
              <span className="nl-sub" style={{ minWidth: 62, display: "inline-block" }}>
                {l.role === "you" ? "You" : l.role === "agent" ? "Store" : ""}
              </span>
              <span className={l.role === "system" ? "mono nl-sub" : undefined}>{l.text}</span>
            </div>
          ))}
        </div>

        {quote !== null && paid === null && (
          <div className="nl-note cs-stack">
            <div className="cs-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 17 }}>{rupees(quote.legal_total_paise)} to pay</strong>
              <span className="nl-sub">
                {quote.applied_bps === 0
                  ? "No coupon applies to this basket."
                  : `${quote.applied_bps / 100}% coupon allowed${quote.offer_id === null ? "" : ` · ${quote.offer_id}`}`}
              </span>
            </div>

            <button
              className="nl-btn"
              disabled={busy}
              style={{ alignSelf: "start" }}
              onClick={() => void finish(quote)}
            >
              {busy ? "Generating…" : issueFailed ? "Try again" : "Generate payment link"}
            </button>

            <p className="nl-sub" style={{ margin: 0, fontStyle: "italic" }}>
              When server-to-server card charge is enabled on this account, the agent will pay with
              the saved card. You will not need to generate a link or pay on Razorpay yourself.
            </p>
          </div>
        )}

        {paid !== null && (
          <div className="nl-note cs-stack">
            <strong>Payment link ready.</strong>
            {typeof paid.short_url === "string" && (
              <a href={paid.short_url} target="_blank" rel="noreferrer" className="mono">
                {paid.short_url}
              </a>
            )}
            <span className="nl-sub">
              {typeof paid.legal_total_paise === "number"
                ? rupees(paid.legal_total_paise)
                : ""}{" "}
              · pay on Razorpay, or use <a href="/gate">/gate</a>. The agent never sees the card.
            </span>
            <a className="nl-btn nl-btn--ghost" href="/orders" style={{ alignSelf: "start" }}>
              View order
            </a>
          </div>
        )}

        {steps.length > 0 && <EvidenceTree steps={steps} raw={raw} />}
      </div>
    </>
  );
}
