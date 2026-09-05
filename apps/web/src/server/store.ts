import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Somewhere to keep merchant state that outlives one request.
 *
 * Three of the things this product promises are shared, not per-browser: the
 * campaigns a merchant runs, the catalog edits they make, and the budget those
 * campaigns have spent. A shopper's assistant has to read them, so a cookie
 * cannot hold them, and Razorpay has no record of them to reconstruct from.
 *
 * On a serverless host they were being written to `/tmp`, which is per instance
 * and is discarded on a cold start. That is not slow persistence, it is no
 * persistence: a merchant created a campaign, refreshed, and it was gone.
 *
 * So this is one small key/value store with three drivers, chosen by what the
 * deployment actually has:
 *
 *   blob       Vercel Blob, when BLOB_READ_WRITE_TOKEN is set. Durable and
 *              shared by every instance. This is the one to use in production.
 *   file       A JSON file on disk. Durable for a laptop, which is all a dev
 *              machine needs.
 *   ephemeral  A file under /tmp on a serverless host. Works within one warm
 *              instance and is gone after that.
 *
 * The last one is not a fallback anyone should be happy with, so it is reported
 * rather than hidden — see `durability()`. A page that reads an ephemeral store
 * must say so instead of rendering an empty table as though nothing happened.
 */

export type Durability = "blob" | "file" | "ephemeral";

function token(): string | null {
  const t = process.env.BLOB_READ_WRITE_TOKEN ?? "";
  return t === "" ? null : t;
}

/** True when this process is running on Vercel, where the disk is throwaway. */
function onVercel(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined;
}

/**
 * What this deployment can actually promise about keeping data.
 *
 * Called by the merchant console so it can be honest on screen rather than
 * showing a merchant an empty campaign list and letting them conclude they
 * imagined creating one.
 */
export function durability(): Durability {
  if (token() !== null) return "blob";
  return onVercel() ? "ephemeral" : "file";
}

/** One sentence a merchant can act on, or null when storage is fine. */
export function durabilityWarning(): string | null {
  if (durability() !== "ephemeral") return null;
  return "Changes here are not being saved permanently: this deployment has no storage attached, so a campaign or catalog edit can disappear when the server restarts. Connect a Vercel Blob store and set BLOB_READ_WRITE_TOKEN to fix it.";
}

function filePath(key: string): string {
  const base = process.env.BARON_STORE_DIR ?? (onVercel() ? "/tmp/baron" : ".data");
  return resolve(base, `${key}.json`);
}

// ------------------------------------------------------------------- the blob
//
// Through the official client, not a hand-rolled fetch. The Blob REST contract
// carries a required `x-api-version` header among other things, and a request
// missing it fails in a way that looks exactly like "nothing was stored" — the
// first version of this file guessed at that contract and silently wrote
// nothing on a deployment that had a perfectly good token.

/** The last write failure, so a route can report it instead of shrugging. */
let lastError: string | null = null;

export function lastStoreError(): string | null {
  return lastError;
}

async function blobRead<T>(key: string): Promise<T | null> {
  const t = token();
  if (t === null) return null;

  try {
    const { head } = await import("@vercel/blob");
    const meta = await head(`${key}.json`, { token: t });

    // `head` throws BlobNotFoundError when there is nothing there, which is a
    // normal empty store rather than a failure.
    const doc = await fetch(meta.url, { cache: "no-store" });
    if (!doc.ok) return null;
    return (await doc.json()) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A first read on an empty store is expected, not an error worth showing.
    if (!/not\s*found/i.test(message)) lastError = `read: ${message}`;
    return null;
  }
}

async function blobWrite(key: string, value: unknown): Promise<boolean> {
  const t = token();
  if (t === null) return false;

  try {
    const { put } = await import("@vercel/blob");
    await put(`${key}.json`, JSON.stringify(value), {
      access: "public",
      token: t,
      contentType: "application/json",
      // One record with one current value, not an append-only upload: a fixed
      // pathname, overwritten in place.
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });
    lastError = null;
    return true;
  } catch (err) {
    lastError = `write: ${err instanceof Error ? err.message : String(err)}`;
    return false;
  }
}

// ------------------------------------------------------------------- the disk

function fileRead<T>(key: string): T | null {
  const path = filePath(key);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    // A torn write reads as "nothing stored", never as a crash.
    return null;
  }
}

function fileWrite(key: string, value: unknown): boolean {
  try {
    const path = filePath(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ the store

/**
 * Read one record.
 *
 * Blob first when it is configured, disk otherwise. A blob that is configured
 * but empty still falls through to disk, which is what makes a local `.data`
 * file a usable seed the first time a store is attached.
 */
export async function readRecord<T>(key: string, fallback: T): Promise<T> {
  if (token() !== null) {
    const fromBlob = await blobRead<T>(key);
    if (fromBlob !== null) return fromBlob;
  }
  return fileRead<T>(key) ?? fallback;
}

/**
 * Write one record.
 *
 * Always writes the local file too, even when Blob is the real store: it costs
 * nothing, and it means a warm instance can still answer from disk if Blob is
 * briefly unreachable. Returns whether the write reached durable storage, so a
 * caller can tell the merchant the truth.
 */
export async function writeRecord(key: string, value: unknown): Promise<boolean> {
  const local = fileWrite(key, value);
  if (token() === null) return local && durability() === "file";
  return await blobWrite(key, value);
}
