import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type IntentMandate,
  checkAgainstIntent,
  hashIntent,
  isExpired,
  mandateHash,
  mintDemoIntent,
} from "./index";

const NOW = new Date("2026-08-31T00:00:00.000Z");

const intent = (over: Partial<IntentMandate> = {}): IntentMandate => ({
  sub: "demo-shopper",
  max_amount_paise: 500_000,
  max_discount_bps: 1500,
  sku_allowlist: [],
  iat: "2026-08-31T00:00:00.000Z",
  exp: "2026-08-31T01:00:00.000Z",
  ...over,
});

describe("mandate chain", () => {
  it("hashes are stable regardless of key order", () => {
    const a = intent();
    const b: IntentMandate = {
      exp: a.exp,
      iat: a.iat,
      sku_allowlist: a.sku_allowlist,
      max_discount_bps: a.max_discount_bps,
      max_amount_paise: a.max_amount_paise,
      sub: a.sub,
    };
    expect(hashIntent(a)).toBe(hashIntent(b));
  });

  it("adding a cart stage changes the mandate hash", () => {
    const i = intent();
    const intentOnly = mandateHash({ intent: i, cart: null, payment: null });
    const withCart = mandateHash({
      intent: i,
      cart: { items: [{ sku_id: "sku_a", qty: 1 }], amount_paise: 100, intent_hash: hashIntent(i) },
      payment: null,
    });

    // A hash minted for one cart cannot stand in for another.
    expect(withCart).not.toBe(intentOnly);
  });

  it("a different cart yields a different hash", () => {
    const i = intent();
    const h = (sku: string) =>
      mandateHash({
        intent: i,
        cart: { items: [{ sku_id: sku, qty: 1 }], amount_paise: 100, intent_hash: hashIntent(i) },
        payment: null,
      });

    expect(h("sku_a")).not.toBe(h("sku_b"));
  });
});

describe("intent enforcement", () => {
  it("over-amount is a refusal — the human never agreed to that number", () => {
    const check = checkAgainstIntent(intent(), 600_000, 0, [], NOW);

    expect(check.valid).toBe(false);
    expect(check.problem).toBe("amount_over_intent");
  });

  it("over-discount is a clamp — they agreed to at most that much off", () => {
    const check = checkAgainstIntent(intent({ max_discount_bps: 500 }), 100_000, 1500, [], NOW);

    expect(check.valid).toBe(true);
    expect(check.allowed_discount_bps).toBe(500);
    expect(check.discount_clamped).toBe(true);
  });

  it("an expired mandate is refused", () => {
    const check = checkAgainstIntent(intent(), 100, 0, [], new Date("2026-09-01T00:00:00.000Z"));

    expect(check.valid).toBe(false);
    expect(check.problem).toBe("expired");
  });

  it("an allowlist excludes anything not named in it", () => {
    const check = checkAgainstIntent(
      intent({ sku_allowlist: ["sku_ok"] }),
      100,
      0,
      ["sku_ok", "sku_other"],
      NOW,
    );

    expect(check.valid).toBe(false);
    expect(check.problem).toBe("sku_not_allowed");
  });

  it("an empty allowlist means any catalog SKU", () => {
    expect(checkAgainstIntent(intent(), 100, 0, ["anything"], NOW).valid).toBe(true);
  });

  it("the demo intent is live when minted and dead after its ttl", () => {
    const demo = mintDemoIntent(NOW, 60);
    expect(isExpired(demo, NOW)).toBe(false);
    expect(isExpired(demo, new Date(NOW.getTime() + 61 * 60_000))).toBe(true);
  });
});

describe("mcp package boundaries", () => {
  it("never imports the payment provider", () => {
    const src = readFileSync(resolve(__dirname, "../../mcp/src/index.ts"), "utf8");

    // Match real imports, not prose: the file's own doc comment names the
    // package precisely to say it must never be imported.
    const importsRazorpay =
      /(?:from|require\()\s*["'][^"']*razorpay[^"']*["']/i.test(src) ||
      /import\s+["'][^"']*razorpay[^"']*["']/i.test(src);

    // MCP is a transport. If it ever imports Razorpay it has a private path to
    // money, which is the whole thing this project exists to prevent.
    expect(importsRazorpay).toBe(false);
    // Nor may it call the provider's API directly.
    expect(src).not.toContain("api.razorpay.com");
  });

  it("reaches money only through the propose route", () => {
    const src = readFileSync(resolve(__dirname, "../../mcp/src/index.ts"), "utf8");
    expect(src).toContain("/api/checkout/propose");
  });
});
