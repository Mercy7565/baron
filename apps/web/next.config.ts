import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

/**
 * Next only reads .env files from this app directory, but the repo keeps one
 * .env at the root so scripts and the app share a single source of truth for
 * credentials. Load it here rather than duplicating secrets into
 * apps/web/.env.local, where the two copies would drift.
 *
 * Development convenience only: on Vercel this file runs at build time, and
 * runtime credentials come from the project's environment variables instead.
 */
function loadRootEnv(): void {
  const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
  if (!existsSync(rootEnv)) return;

  for (const line of readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    // A real environment variable always wins over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next's app router skips directories beginning with a dot, so the
  // /.well-known/* routes live under app/well-known/* and are rewritten here.
  async rewrites() {
    return [
      { source: "/.well-known/countersign.json", destination: "/well-known/countersign.json" },
      { source: "/.well-known/ucp", destination: "/well-known/ucp" },
    ];
  },
  // Internal packages ship TypeScript source with no build step, so Next has
  // to compile them alongside the app.
  transpilePackages: [
    "@countersign/campaigns",
    "@countersign/catalog",
    "@countersign/contracts",
    "@countersign/guard",
    "@countersign/kernel",
    "@countersign/mandates",
    "@countersign/ledger",
    "@countersign/db",
    "@countersign/razorpay",
    "@countersign/orders",
    "@countersign/quotes",
    "@countersign/resume",
    "@countersign/vault",
  ],
};

export default nextConfig;
