"use client";

import { useEffect, useState } from "react";

import { KeyRound, Send } from "lucide-react";

import { NO_SHOP_REPLY } from "@/lib/agent-copy";

import { ShopCodeForm } from "./ShopCodeForm";
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
  /**
   * Which shop this browser is in. `null` while we are still asking.
   *
   * The cookie is httpOnly, so the assistant cannot read the flag it is gated
   * on — it has to be told. Until it knows, it shows nothing rather than
   * guessing, because guessing here means an input box that looks live and is
   * not.
   */
  const [shop, setShop] = useState<{ unlocked: boolean; code: string | null } | null>(null);

  useEffect(() => {
    void fetch("/api/shop/code")
      .then((r) => r.json())
      .then((d: { unlocked?: boolean; code?: string | null }) =>
        setShop({ unlocked: d.unlocked === true, code: d.code ?? null }),
      )
      .catch(() => setShop({ unlocked: false, code: null }));
  }, []);

  useEffect(() => {
    if (shop?.unlocked !== true) return;
    void fetch("/api/mandates/demo", { method: "POST" })
      .then((r) => r.json())
      .then((d: { mandate_hash: string }) => setMandate(d.mandate_hash));
  }, [shop?.unlocked]);

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

    // Blind: say so and stop. No search, no add, no suggestion, no quote — and
    // above all no product name, because naming one would mean inventing it.
    if (shop?.unlocked !== true) {
      say("you", text);
      say("agent", NO_SHOP_REPLY);
      return;
    }

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

        // The shop was left in another tab while this one was open. Say the
        // real reason and go blind, rather than reporting "not found" — the
        // product may well exist; we simply have no shop to look in.
        if (sr.status === 403) {
          say("agent", NO_SHOP_REPLY);
          setShop({ unlocked: false, code: null });
          return;
        }

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

  // Still asking which shop we are in. An input that looks live but is not is
  // worse than a blank space for the half-second this takes.
  if (shop === null) {
    return <div className="ag-panel ag-waiting" aria-busy="true" />;
  }

  /**
   * Blind.
   *
   * A composed screen, not an error: nothing has gone wrong, the shopper simply
   * has not said which shop they are in. So it reads as a door — one sentence,
   * one field — rather than as a failure the shopper has to decode.
   */
  if (!shop.unlocked) {
    return (
      <div className="ag-panel ag-blind">
        <KeyRound size={22} strokeWidth={1.75} aria-hidden />
        <h2>No shop selected</h2>
        <p className="st-muted">{NO_SHOP_REPLY}</p>
        <ShopCodeForm />
      </div>
    );
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

      <div className="ag-panel">
        <div className="ag-chips">
          {["buy me the niacinamide", "buy me the invisible sunscreen"].map((s) => (
            <button key={s} className="ag-chip" disabled={busy} onClick={() => void handle(s)}>
              {s}
            </button>
          ))}
        </div>

        {/* Three voices, three shapes: what you said, what the store answered,
            and the machine notes underneath. Quiet, but never ambiguous. */}
        <div className="ag-log" role="log" aria-label="agent transcript">
          {lines.map((l, i) => (
            <div className="ag-turn" key={i} data-role={l.role}>
              <span className="ag-who">
                {l.role === "you" ? "You" : l.role === "agent" ? "Store" : "Tool"}
              </span>
              <span className="ag-said">{l.text}</span>
            </div>
          ))}
        </div>

        <form
          className="ag-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void handle(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Tell the assistant what you want"
            placeholder={`Shopping ${shop.code ?? ""} — tell the assistant what you want`}
          />
          <button className="st-btn ag-send" disabled={busy} type="submit" title="Send">
            <Send size={18} strokeWidth={2} aria-hidden />
            <span>{busy ? "…" : "Send"}</span>
          </button>
        </form>

        {quote !== null && paid === null && (
          <div className="st-note ag-settle">
            <div className="ag-settle-head">
              <strong className="nl-money">{rupees(quote.legal_total_paise)} to pay</strong>
              <span className="st-muted">
                {quote.applied_bps === 0
                  ? "No coupon applies to this basket."
                  : `${quote.applied_bps / 100}% coupon allowed${quote.offer_id === null ? "" : ` · ${quote.offer_id}`}`}
              </span>
            </div>

            <button className="st-btn" disabled={busy} onClick={() => void finish(quote)}>
              {busy ? "Generating…" : issueFailed ? "Try again" : "Generate payment link"}
            </button>
          </div>
        )}

        {paid !== null && (
          <div className="st-note ag-settle">
            <strong>Payment link ready.</strong>
            {typeof paid.short_url === "string" && (
              <a href={paid.short_url} target="_blank" rel="noreferrer" className="mono">
                {paid.short_url}
              </a>
            )}
            <span className="st-muted">
              {typeof paid.legal_total_paise === "number"
                ? rupees(paid.legal_total_paise)
                : ""}{" "}
              · pay on Razorpay, or use <a href="/gate">/gate</a>. The agent never sees the card.
            </span>
            <a className="st-btn st-btn--quiet ag-selfstart" href="/orders">
              View order
            </a>
          </div>
        )}

        {steps.length > 0 && <EvidenceTree steps={steps} raw={raw} />}
      </div>
    </>
  );
}
