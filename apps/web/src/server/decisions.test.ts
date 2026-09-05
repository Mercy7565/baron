import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The ledger must not go blank when /tmp does.
 *
 * The audit page and the merchant overview read the quote log, which lives in
 * /tmp on a serverless host and does not survive a cold start. They therefore
 * showed nothing while the Razorpay dashboard showed captures — the same
 * failure the orders pages had, in the one place whose whole claim is that it
 * can account for money.
 *
 * These run with no credentials on purpose, so nothing touches the network.
 * What is pinned is that the empty case is calm and that the explainers refuse
 * to reason about a decision they do not have.
 */

const KEYS = [
  "ORDERS_LOG_PATH",
  "QUOTE_LOG_PATH",
  "AUDIT_LOG_PATH",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env.ORDERS_LOG_PATH = "/nonexistent-baron-audit/orders.jsonl";
  process.env.QUOTE_LOG_PATH = "/nonexistent-baron-audit/quotes.jsonl";
  process.env.AUDIT_LOG_PATH = "/nonexistent-baron-audit/audit.jsonl";
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the decision ledger with no local log", () => {
  it("returns rows instead of throwing", async () => {
    const { paidDecisionRows } = await import("./ledger-rows");
    await expect(paidDecisionRows()).resolves.toEqual([]);
  });
});

describe("a payment Razorpay reports but the log cannot explain", () => {
  /** The shape `razorpayOnlyRow` produces, built here so the explainers can be
   * exercised without a network call. */
  const unexplained = {
    key: "pay_x",
    ts: "2026-09-05T10:00:00.000Z",
    actor: "unknown",
    actor_kind: "customer" as const,
    asked: "not recorded",
    found: "not recorded",
    campaign: null,
    upsell_accepted: null,
    asked_bps: 0,
    applied_bps: 0,
    offer_id: "offer_TXuanzMIxTBH9p",
    attached: true,
    subtotal_paise: 169_800,
    total_paise: 151_122,
    outcome: "paid" as const,
    payment_id: "pay_x",
    short_url: null,
    verdict: "CAPTURED",
    decision_id: null,
    quote_id: "",
    order_id: "order_x",
    seq: null,
    hash: null,
    prev_hash: null,
    margin_bps: 0,
    live: true,
    campaign_dry: false,
    verdict_known: false,
    shop_code: "BARON-SKIN",
    captured_paise: 151_122,
    payment_link_id: "plink_x",
    source: "razorpay" as const,
  };

  it("is described as captured, never as a policy decision", async () => {
    const { causeOf } = await import("./ledger-rows");
    const cause = causeOf(unexplained);

    expect(cause).toContain("Captured by Razorpay");
    // The reasoning branches all talk about gates. None of them may fire on a
    // row whose ask and margin are unknown.
    expect(cause).not.toContain("margin floor");
    expect(cause).not.toContain("minimum");
  });

  it("never claims an ask it does not have", async () => {
    const { whyRow } = await import("./ledger-rows");
    const why = whyRow(unexplained);

    expect(why).not.toContain("We asked for 0%");
    expect(why).toContain("no longer in the local log");
    expect(why).toContain("pay_x");
  });

  it("exports a copyable row that admits what is missing", async () => {
    const { rowAsText } = await import("./ledger-rows");
    const text = rowAsText(unexplained);

    expect(text).toContain("captured by Razorpay");
    expect(text).toContain("asked (unknown) -> allowed (unknown)");
    expect(text).toContain("BARON-SKIN");
    expect(text).toContain("offer_TXuanzMIxTBH9p");
  });
});
