import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@countersign/campaigns": pkg("campaigns"),
      "@countersign/catalog": pkg("catalog"),
      "@countersign/contracts": pkg("contracts"),
      "@countersign/guard": pkg("guard"),
      "@countersign/kernel": pkg("kernel"),
      "@countersign/mandates": pkg("mandates"),
      "@countersign/mcp": pkg("mcp"),
      "@countersign/ledger": pkg("ledger"),
      "@countersign/db": pkg("db"),
      "@countersign/razorpay": pkg("razorpay"),
      "@countersign/orders": pkg("orders"),
      "@countersign/quotes": pkg("quotes"),
      "@countersign/resume": pkg("resume"),
      "@countersign/vault": pkg("vault"),
      // The web app's own path alias, so server modules can be unit-tested
      // without standing up Next.
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
