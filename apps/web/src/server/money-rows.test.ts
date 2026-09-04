import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The ledger has to survive the host it runs on.
 *
 * On Vercel the JSONL logs live in /tmp, which is per-instance and gone after a
 * cold start. A page that reads them must therefore treat "no file" as "no
 * cache" — never as an error, and never as proof that no money moved. These
 * tests run with no Razorpay credentials on purpose, so nothing here touches
 * the network: what is being pinned is that the empty case is calm.
 */

const ENV_KEYS = [
  "ORDERS_LOG_PATH",
  "QUOTE_LOG_PATH",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // A path that certainly does not exist, which is exactly the wiped-/tmp case.
  process.env.ORDERS_LOG_PATH = "/nonexistent-baron-test/orders.jsonl";
  process.env.QUOTE_LOG_PATH = "/nonexistent-baron-test/quotes.jsonl";
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the money ledger with no local log and no credentials", () => {
  it("returns an empty ledger instead of throwing", async () => {
    const { moneyLedger } = await import("./money-rows");
    const ledger = await moneyLedger();

    expect(ledger.rows).toEqual([]);
    expect(ledger.counts).toEqual({ paid: 0, awaiting: 0, closed: 0, failed: 0 });
  });

  it("says plainly that it is not live, rather than implying no money moved", async () => {
    const { moneyLedger } = await import("./money-rows");
    const ledger = await moneyLedger();

    // The distinction the whole page rests on: "we could not look" is not the
    // same claim as "there is nothing there".
    expect(ledger.live).toBe(false);
    expect(ledger.error).not.toBeNull();
  });

  it("narrows to a buyer without throwing on an absent log", async () => {
    const { moneyLedgerFor } = await import("./money-rows");
    const ledger = await moneyLedgerFor("aryan");

    expect(ledger.rows).toEqual([]);
    expect(ledger.live).toBe(false);
  });
});
