import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Merchant state has to outlive one process.
 *
 * Campaigns, catalog edits and the margin floor are shared: a shopper's
 * assistant reads them, so a cookie cannot hold them and Razorpay has no record
 * to reconstruct them from. They were being written to /tmp, which on a
 * serverless host is per instance and discarded on a cold start — a merchant
 * created a campaign, refreshed, and it was gone.
 *
 * What is pinned here is the round trip through a fresh process, and the part
 * that matters more: that the store says out loud when it cannot promise
 * anything, instead of quietly losing writes.
 */

let dir: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ["BARON_STORE_DIR", "BLOB_READ_WRITE_TOKEN", "VERCEL", "VERCEL_ENV"]) {
    saved[k] = process.env[k];
  }
  dir = mkdtempSync(join(tmpdir(), "baron-store-"));
  process.env.BARON_STORE_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("the durable store", () => {
  it("reads back what a previous process wrote", async () => {
    const { readRecord, writeRecord } = await import("./store");

    await writeRecord("probe", { campaigns: ["cmp_one"], floor: 1500 });

    // A different module instance is what a new lambda amounts to. `readRecord`
    // holds no cache of its own, so this genuinely goes back to storage.
    const back = await readRecord<{ campaigns: string[]; floor: number }>("probe", {
      campaigns: [],
      floor: 0,
    });

    expect(back.campaigns).toEqual(["cmp_one"]);
    expect(back.floor).toBe(1500);
  });

  it("returns the caller's fallback rather than throwing on a missing record", async () => {
    const { readRecord } = await import("./store");
    await expect(readRecord("never-written", { ok: true })).resolves.toEqual({ ok: true });
  });

  it("reports a disk store as durable, with nothing to warn about", async () => {
    const { durability, durabilityWarning } = await import("./store");
    expect(durability()).toBe("file");
    expect(durabilityWarning()).toBeNull();
  });

  it("admits that /tmp on a serverless host is not storage", async () => {
    // This is the case that produced the bug. It must be reported, because the
    // alternative is a merchant seeing an empty campaign list and concluding
    // they imagined creating one.
    delete process.env.BARON_STORE_DIR;
    process.env.VERCEL = "1";

    const { durability, durabilityWarning } = await import("./store");
    expect(durability()).toBe("ephemeral");
    expect(durabilityWarning()).toContain("not being saved permanently");
  });

  it("prefers Vercel Blob the moment a token exists", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_TEST";
    const { durability, durabilityWarning } = await import("./store");

    expect(durability()).toBe("blob");
    expect(durabilityWarning()).toBeNull();
  });
});
