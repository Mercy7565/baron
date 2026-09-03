/**
 * pnpm data:clear
 *
 * Empty the local ledger files so a demo starts from a true zero.
 *
 * Why this exists: orders and audit rows are append-only and keyed to whatever
 * Razorpay test account issued them. Swap the key pair — or hit the account's
 * Payment Link cap and move on — and the old rows survive as orders stuck at
 * `awaiting_payment` whose links can never be paid or even fetched. Those rows
 * are real history, but they are history from an account this deployment can
 * no longer talk to, so they inflate the awaiting count with money that will
 * never arrive.
 *
 * This truncates rather than doctors: it never rewrites a row, never marks
 * anything paid, and never invents a payment id. Everything it removes was
 * written by an earlier run against a different account.
 *
 * Run it once before a demo, then let the real run fill the files back up.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "apps", "web", ".data");

/** Truncated on purpose. Each one is an append-only log, not a database. */
const FILES = [
  ["orders.jsonl", "orders, payment links and their paid/awaiting status"],
  ["audit.jsonl", "the hash-chained decision ledger"],
  ["quotes.jsonl", "quotes and decision records"],
  ["cart.json", "the saved basket"],
] as const;

function countLines(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "").length;
}

let total = 0;
for (const [file, what] of FILES) {
  const path = resolve(ROOT, file);
  const n = countLines(path);
  total += n;
  if (n === 0) {
    console.log(`  ${file.padEnd(14)} already empty (${what})`);
    continue;
  }
  writeFileSync(path, "", "utf8");
  console.log(`  ${file.padEnd(14)} cleared ${n} row${n === 1 ? "" : "s"} (${what})`);
}

console.log(
  total === 0
    ? "\nNothing to clear. The ledger is already at zero."
    : `\nCleared ${total} rows. The audit chain restarts from genesis on the next decision.`,
);
console.log(
  "Untouched: the catalog, the seven coupon ids, the merchant overlay " +
    "(margin floor, prices, campaign budgets), the wallet token, and .env.",
);
console.log("The in-memory cart lives in the dev server; restart it to clear that too.");
