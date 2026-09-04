import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_RESPONSE_KEYS,
  SHOPPER_HEADER,
  leaksSecret,
  scopeFor,
  shopperFrom,
} from "./gpt-shopper";

/**
 * The Custom GPT surface, held to the two promises that matter.
 *
 * A model shopping on someone's behalf is the least trusted caller in the
 * system: it can be prompt-injected by the page it just read, and it has every
 * incentive to make the bill match whatever it already said out loud. So the
 * guarantees cannot live in a comment — they have to be assertions.
 */

const req = (headers: Record<string, string> = {}): Request =>
  new Request("https://baron.test/api/gpt/search", { headers });

describe("who a GPT is allowed to shop as", () => {
  it("honours the built-in demo customer by name", () => {
    expect(shopperFrom(req({ [SHOPPER_HEADER]: "aryan" }))).toBe("aryan");
    expect(shopperFrom(req({ [SHOPPER_HEADER]: "  ARYAN " }))).toBe("aryan");
  });

  it("falls back to the shared demo buyer rather than inventing an identity", () => {
    // The important half: a caller cannot file an order against a name it made
    // up, because an arbitrary header value is never taken at face value.
    expect(shopperFrom(req({ [SHOPPER_HEADER]: "someone-elses-account" }))).toBe("demo");
    expect(shopperFrom(req())).toBe("demo");
  });
});

describe("which shop a GPT can see", () => {
  it("resolves the demo shop code, however it was typed", () => {
    expect(scopeFor("BARON-SKIN")?.code).toBe("BARON-SKIN");
    expect(scopeFor("baron skin")?.code).toBe("BARON-SKIN");
  });

  it("refuses an unknown code instead of falling back to a default shop", () => {
    // A platform with one visible tenant is still a platform: guessing a code
    // must open nothing, or the code means nothing.
    expect(scopeFor("NOPE-123")).toBeNull();
    expect(scopeFor("")).toBeNull();
    expect(scopeFor(null)).toBeNull();
  });
});

describe("what a GPT may never be handed", () => {
  it("names the fields that must never reach a model", () => {
    for (const key of ["pan", "cvv", "otp", "key_secret", "wallet"]) {
      expect(FORBIDDEN_RESPONSE_KEYS).toContain(key);
    }
  });

  it("catches a secret at any depth, including inside an array", () => {
    expect(leaksSecret({ short_url: "https://rzp.io/x", paid: false })).toBeNull();
    expect(leaksSecret({ card: { cvv: "123" } })).toBe("cvv");
    expect(leaksSecret({ rows: [{ ok: true }, { wallet: {} }] })).toBe("wallet");
    expect(leaksSecret({ a: { b: { c: { key_secret: "…" } } } })).toBe("key_secret");
  });

  it("does not hang on a cyclic object", () => {
    const cyclic: Record<string, unknown> = { ok: true };
    cyclic.self = cyclic;
    expect(leaksSecret(cyclic)).toBeNull();
  });

  it("passes a realistic pay_quote body", () => {
    // The exact shape the pay route returns. If a field is ever added that
    // carries a card or a secret, this is what fails.
    const payload = {
      status: "ready_to_pay",
      quote_id: "qt_abc",
      verdict: "CLAMP",
      legal_total_paise: 151122,
      legal_total_inr: 1511.22,
      applied_bps: 1100,
      offer_id: "offer_TXuanzMIxTBH9p",
      order_id: "order_x",
      payment_link_id: "plink_x",
      short_url: "https://rzp.io/rzp/x",
      paid: false,
    };
    expect(leaksSecret(payload)).toBeNull();
  });
});
