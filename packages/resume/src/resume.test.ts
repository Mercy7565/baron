import { describe, expect, it } from "vitest";

import { RESUME_TTL_MS, signResume, verifyResume } from "./index";

const SECRET = "test-secret";
const NOW = Date.parse("2026-09-02T12:00:00.000Z");

const payload = {
  intent: "buy me niacinamide",
  lines: [{ sku_id: "sku_serum_niacin_30", qty: 1 }],
  suggestions: [
    {
      sku_id: "sku_serum_vitc_30",
      title: "Vitamin C 15% Serum 30ml",
      price_paise: 129_900,
      extra_bps: 300,
    },
  ],
  mandate_hash: "mh_abc",
};

describe("resume tokens survive without a file", () => {
  it("round-trips its whole state through the signature alone", async () => {
    const token = await signResume(payload, SECRET, NOW);

    // No disk, no index, no shared memory — a second instance holding the same
    // secret can complete round 2 from the token by itself.
    const result = await verifyResume(token, SECRET, NOW + 1000);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.lines).toEqual(payload.lines);
    expect(result.payload.suggestions[0]?.sku_id).toBe("sku_serum_vitc_30");
    expect(result.payload.mandate_hash).toBe("mh_abc");
    expect(result.payload.intent).toBe("buy me niacinamide");
  });

  it("expires fifteen minutes after minting", async () => {
    const token = await signResume(payload, SECRET, NOW);

    const justInside = await verifyResume(token, SECRET, NOW + RESUME_TTL_MS - 1000);
    expect(justInside.ok).toBe(true);

    const justOutside = await verifyResume(token, SECRET, NOW + RESUME_TTL_MS + 1000);
    expect(justOutside.ok).toBe(false);
    if (justOutside.ok) return;
    expect(justOutside.reason).toBe("expired");
  });

  it("refuses a token signed with a different secret", async () => {
    const token = await signResume(payload, "someone-elses-secret", NOW);

    const result = await verifyResume(token, SECRET, NOW + 1000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
  });

  it("refuses a token whose body was edited", async () => {
    const token = await signResume(payload, SECRET, NOW);

    // Flip characters in the payload half, leaving the signature alone.
    const dot = token.lastIndexOf(".");
    const body = token.slice(3, dot);
    const swapped = body.slice(-2) === "AA" ? "BB" : "AA";
    const tampered = `rt_${body.slice(0, -2)}${swapped}${token.slice(dot)}`;

    const result = await verifyResume(tampered, SECRET, NOW + 1000);
    expect(result.ok).toBe(false);
  });

  it("rejects junk rather than throwing", async () => {
    for (const junk of ["", "not-a-token", "rt_", "rt_abc", "rt_abc.def"]) {
      const result = await verifyResume(junk, SECRET, NOW);
      expect(result.ok).toBe(false);
    }
    expect((await verifyResume(null, SECRET, NOW)).ok).toBe(false);
  });

  it("carries no card number or step-up code", async () => {
    const token = await signResume(payload, SECRET, NOW);
    expect(token).not.toContain("5267");
    expect(token).not.toContain("1234");

    const result = await verifyResume(token, SECRET, NOW + 1000);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("5267318187975449");
    expect(serialised).not.toContain("1234");
  });
});
