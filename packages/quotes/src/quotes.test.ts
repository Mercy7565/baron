import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Catalog, priceCart } from "@countersign/catalog";
import { evaluate } from "@countersign/kernel";
import { buildOrderNotes } from "@countersign/ledger";

import catalogJson from "../../../apps/web/src/data/catalog.json";

import {
  type Quote,
  type QuoteLine,
  appendQuote,
  computeLegalTotal,
  getQuote,
  isExpired,
  loadQuotes,
  paymentForQuote,
  quoteId,
  quoteIdForDecision,
  updateQuote,
} from "./index";

const CATALOG = catalogJson as Catalog;

const POLICY = {
  policy_version: "v0.1.0",
  max_order_paise: 500_000,
  escalate_above_paise: null,
  margin_floor_bps: 4800,
  blocked_product_ids: ["sku_blocked"],
  ladder: [
    { discount_bps: 200, offer_id: "offer_TXuWY6xddeXxVe", min_cart_paise: 10_000, max_discount_paise: 15_000 },
    { discount_bps: 500, offer_id: "offer_TXuXqoGAWqOZHA", min_cart_paise: 50_000, max_discount_paise: 40_000 },
    { discount_bps: 700, offer_id: "offer_TXuZNylUfodChM", min_cart_paise: 80_000, max_discount_paise: 50_000 },
    { discount_bps: 1100, offer_id: "offer_TXuanzMIxTBH9p", min_cart_paise: 120_000, max_discount_paise: 80_000 },
    { discount_bps: 1500, offer_id: "offer_TXuc8SQ7e1mTBO", min_cart_paise: 180_000, max_discount_paise: 100_000 },
    { discount_bps: 2000, offer_id: "offer_TXudQjjRCRnoXQ", min_cart_paise: 250_000, max_discount_paise: 120_000 },
    { discount_bps: 2500, offer_id: "offer_TXueiFQ59z3ARk", min_cart_paise: 350_000, max_discount_paise: 150_000 },
  ],


};

const LADDER_IDS = POLICY.ladder.map((r) => r.offer_id);

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cs-quotes-"));
  process.env.QUOTE_LOG_PATH = join(dir, "quotes.jsonl");
  loadQuotes(true);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("legal total", () => {
  it("is catalog price x qty, never a supplied number", () => {
    const lines: QuoteLine[] = [
      {
        sku_id: "sku_serum_niacin_30",
        title: "Niacinamide 5% Serum 30ml",
        qty: 2,
        unit_price_paise: 84_900,
        line_total_paise: 169_800,
      },
    ];

    const { subtotal_paise, legal_total_paise } = computeLegalTotal(lines, 0);
    expect(subtotal_paise).toBe(169_800);
    expect(legal_total_paise).toBe(169_800);
  });

  it("applies the discount in bps and floors to whole paise", () => {
    const lines: QuoteLine[] = [
      {
        sku_id: "x",
        title: "x",
        qty: 1,
        unit_price_paise: 84_900,
        line_total_paise: 84_900,
      },
    ];

    // 5% of 84900 = 4245
    expect(computeLegalTotal(lines, 500).legal_total_paise).toBe(80_655);
    // 8% of 84900 = 6792
    expect(computeLegalTotal(lines, 800).legal_total_paise).toBe(78_108);
  });
});

describe("kernel behaviour behind a quote", () => {
  it("clamps a 1500 bps ask to a ladder value and only ever a ladder offer id", () => {
    const cart = priceCart(CATALOG, [{ sku_id: "sku_serum_niacin_30", qty: 1 }]);

    const verdict = evaluate(
      {
        cart_id: "q",
        amount_paise: cart.amount_paise,
        currency: "INR",
        requested_discount_bps: 1500,
        requested_offer_id: null,
        product_ids: cart.product_ids,
        margin_bps: cart.margin_bps,
      },
      POLICY,
    );

    expect(verdict.verdict).toBe("CLAMP");
    expect(verdict.applied_discount_bps).toBeLessThan(1500);
    // The applied value is a real rung, and the id came from the ladder.
    expect(POLICY.ladder.map((r) => r.discount_bps)).toContain(verdict.applied_discount_bps);
    for (const id of verdict.offer_ids) expect(LADDER_IDS).toContain(id);
  });

  it("a junk requested_offer_id never becomes the applied offer", () => {
    const cart = priceCart(CATALOG, [{ sku_id: "sku_serum_niacin_30", qty: 1 }]);

    const verdict = evaluate(
      {
        cart_id: "q",
        amount_paise: cart.amount_paise,
        currency: "INR",
        requested_discount_bps: 1500,
        requested_offer_id: "offer_ATTACKER123",
        product_ids: cart.product_ids,
        margin_bps: cart.margin_bps,
      },
      POLICY,
    );

    expect(verdict.offer_ids).not.toContain("offer_ATTACKER123");
    for (const id of verdict.offer_ids) expect(LADDER_IDS).toContain(id);
    expect(verdict.ignored_inputs.join(" ")).toContain("offer_ATTACKER123");
  });
});

describe("quote_id linkage", () => {
  const proposal = {
    cart_id: "q",
    amount_paise: 84_900,
    currency: "INR" as const,
    requested_discount_bps: 500,
    requested_offer_id: null,
    product_ids: ["sku_serum_niacin_30"],
    margin_bps: 5200,
  };

  it("inputs_hash changes when quote_id changes", () => {
    const verdict = evaluate(proposal, POLICY);

    const a = buildOrderNotes(proposal, POLICY, verdict, { quote_id: "qt_aaa" });
    const b = buildOrderNotes(proposal, POLICY, verdict, { quote_id: "qt_bbb" });

    expect(a.inputs_hash).not.toBe(b.inputs_hash);
    // And the decision id, which is derived from it, moves too.
    expect(a.decision_id).not.toBe(b.decision_id);
  });

  it("adds no fifth key to order notes", () => {
    const verdict = evaluate(proposal, POLICY);
    const notes = buildOrderNotes(proposal, POLICY, verdict, { quote_id: "qt_aaa" });

    expect(Object.keys(notes).sort()).toEqual([
      "decision_id",
      "inputs_hash",
      "mandate_hash",
      "policy_version",
    ]);
  });
});

describe("quote store", () => {
  const makeQuote = (over: Partial<Quote> = {}): Quote => ({
    quote_id: quoteId("seed-1"),
    status: "quoted",
    created_at: "2026-08-31T00:00:00.000Z",
    expires_at: "2026-08-31T00:10:00.000Z",
    buyer_user_id: "demo",
    agent_id: "test",
    mandate_hash: "mh",
    lines: [],
    subtotal_paise: 84_900,
    legal_total_paise: 80_655,
    asked_bps: 1500,
    applied_bps: 500,
    offer_id: "offer_TXuXqoGAWqOZHA",
    campaign_id: null,
    decision_id: "dec_abc",
    verdict: "CLAMP",
    upsell: [],
    mistakes_repaired: [],
    ignored_inputs: [],
    payment_id: null,
    order_id: null,
    superseded_by: null,
    payment_link_id: null,
    payment_link_short_url: null,
    ...over,
  });

  it("round-trips through the append-only log", () => {
    const q = appendQuote(makeQuote());
    expect(getQuote(q.quote_id)).toEqual(q);
  });

  it("indexes decision_id -> quote_id, rebuildable from the JSONL", () => {
    const q = appendQuote(makeQuote({ quote_id: quoteId("seed-2"), decision_id: "dec_xyz" }));

    // Drop the in-memory index and rebuild from disk, as a boot would.
    loadQuotes(true);
    expect(quoteIdForDecision("dec_xyz")).toBe(q.quote_id);
  });

  it("expires ten minutes after creation", () => {
    const q = makeQuote();
    expect(isExpired(q, new Date("2026-08-31T00:09:59.000Z"))).toBe(false);
    expect(isExpired(q, new Date("2026-08-31T00:10:01.000Z"))).toBe(true);
  });
});

describe("quote lifecycle", () => {
  const base = (id: string): Quote => ({
    quote_id: id,
    status: "quoted",
    created_at: "2026-08-31T00:00:00.000Z",
    expires_at: "2026-08-31T00:10:00.000Z",
    buyer_user_id: "demo",
    agent_id: "agent_test",
    mandate_hash: "mh",
    lines: [],
    subtotal_paise: 84_900,
    legal_total_paise: 80_655,
    asked_bps: 1500,
    applied_bps: 500,
    offer_id: "offer_TXuXqoGAWqOZHA",
    campaign_id: null,
    decision_id: `dec_${id}`,
    verdict: "CLAMP",
    upsell: [],
    mistakes_repaired: [],
    ignored_inputs: [],
    payment_id: null,
    order_id: null,
    superseded_by: null,
    payment_link_id: null,
    payment_link_short_url: null,
  });

  it("status changes are appended, and a rebuild lands on the latest state", () => {
    const q = appendQuote(base(quoteId("lifecycle-1")));

    updateQuote(q.quote_id, { status: "approved" });
    expect(getQuote(q.quote_id)?.status).toBe("approved");

    // The log is append-only, so the rebuild must still see "approved".
    loadQuotes(true);
    expect(getQuote(q.quote_id)?.status).toBe("approved");
  });

  it("a paid quote reports its payment, which is what makes pay idempotent", () => {
    const q = appendQuote(base(quoteId("lifecycle-2")));
    expect(paymentForQuote(q.quote_id)).toBeNull();

    updateQuote(q.quote_id, {
      status: "paid",
      payment_id: "pay_sim_abc123def456",
      order_id: "order_X",
    });

    // Survives a rebuild: a restarted process must not charge a second time.
    loadQuotes(true);
    expect(paymentForQuote(q.quote_id)).toEqual({
      payment_id: "pay_sim_abc123def456",
      order_id: "order_X",
    });
  });

  it("a superseded quote points at its replacement", () => {
    const old = appendQuote(base(quoteId("lifecycle-3")));
    const fresh = appendQuote(base(quoteId("lifecycle-4")));

    updateQuote(old.quote_id, { status: "superseded", superseded_by: fresh.quote_id });

    loadQuotes(true);
    const reloaded = getQuote(old.quote_id);
    expect(reloaded?.status).toBe("superseded");
    expect(reloaded?.superseded_by).toBe(fresh.quote_id);
  });
});

describe("upsell consent", () => {
  const SUGGESTED = "sku_serum_vitc_30";
  const BASE = "sku_serum_niacin_30";

  it("reject → the quoted basket omits the suggested sku", () => {
    const cart = priceCart(CATALOG, [{ sku_id: BASE, qty: 1 }]);

    expect(cart.product_ids).toContain(BASE);
    // Nothing was added, because nothing was accepted.
    expect(cart.product_ids).not.toContain(SUGGESTED);
  });

  it("accept → the suggested sku is in the quoted basket", () => {
    const cart = priceCart(CATALOG, [
      { sku_id: BASE, qty: 1 },
      { sku_id: SUGGESTED, qty: 1 },
    ]);

    expect(cart.product_ids).toContain(BASE);
    expect(cart.product_ids).toContain(SUGGESTED);
  });

  it("accepting can unlock a higher legal rung, and the kernel still decides it", () => {
    const alone = priceCart(CATALOG, [{ sku_id: BASE, qty: 1 }]);
    const withUpsell = priceCart(CATALOG, [
      { sku_id: BASE, qty: 1 },
      { sku_id: SUGGESTED, qty: 1 },
    ]);

    const ask = (cart: typeof alone) =>
      evaluate(
        {
          cart_id: "q",
          amount_paise: cart.amount_paise,
          currency: "INR",
          requested_discount_bps: 1500,
          requested_offer_id: null,
          product_ids: cart.product_ids,
          margin_bps: cart.margin_bps,
        },
        POLICY,
      );

    const before = ask(alone);
    const after = ask(withUpsell);

    // The bigger basket carries more margin, so more discount is legal — but
    // both are still clamped well below the 15% that was asked for.
    expect(after.applied_discount_bps).toBeGreaterThan(before.applied_discount_bps);
    expect(after.applied_discount_bps).toBeLessThan(1500);
    for (const id of after.offer_ids) expect(LADDER_IDS).toContain(id);
  });
});
