import { cookies } from "next/headers";

import { NO_SHOP_REPLY } from "@/lib/agent-copy";
import { CATALOG } from "@/lib/catalog";
import { DEFAULT_TENANT } from "@/server/users";

/**
 * The code a shopper types to reach a merchant's shop.
 *
 * Baron is a platform: a merchant registers, loads a catalog, and only then has
 * something worth showing anyone. The code is that moment made concrete — it
 * appears once the shelf is not empty, and a shopper cannot browse a merchant
 * they have not been given the code for.
 *
 * One real tenant for now, so the mapping is a constant rather than a table. A
 * second merchant needs a catalog of its own before a lookup would mean
 * anything, and inventing the table before the second catalog exists would be
 * building the shape of a feature without the feature.
 */
export const SHOP_CODE_COOKIE = "baron_shop";

const CODES: Record<string, string> = {
  "BARON-SKIN": DEFAULT_TENANT,
};

/** Normalised so "baron skin" and "baron-skin" both work for someone typing fast. */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "-");
}

export function tenantForCode(input: string): string | null {
  return CODES[normaliseCode(input)] ?? null;
}

/**
 * A merchant's code, if they have earned one.
 *
 * Null until the catalog holds at least one sellable SKU. A code that opens an
 * empty shop wastes a shopper's time and makes the platform look broken.
 */
export function shopCodeFor(tenantId: string): string | null {
  const sellable = CATALOG.products.filter(
    (p) => !p.blocked && p.availability === "in_stock" && p.stock_qty > 0,
  );
  if (sellable.length === 0) return null;

  const entry = Object.entries(CODES).find(([, t]) => t === tenantId);
  return entry?.[0] ?? null;
}

/** The tenant this browser has unlocked, if any. */
export async function unlockedTenant(): Promise<string | null> {
  const jar = await cookies();
  const code = jar.get(SHOP_CODE_COOKIE)?.value;
  return code === undefined ? null : tenantForCode(code);
}

/** The code this browser typed, so the shop can name the shelf it is showing. */
export async function enteredCode(): Promise<string | null> {
  const jar = await cookies();
  const code = jar.get(SHOP_CODE_COOKIE)?.value ?? null;
  // Only report a code that still resolves: a retired one is not where the
  // shopper is, it is a stale cookie.
  return code !== null && tenantForCode(code) !== null ? normaliseCode(code) : null;
}

/**
 * Gate for the assistant's own routes.
 *
 * Returns a refusal Response when this browser holds no valid shop code, and
 * null when it does. The check is the cookie, which is the same flag Exit shop
 * clears, so leaving a shop blinds the agent in the same breath as hiding the
 * catalog.
 */
export async function requireShopCode(): Promise<Response | null> {
  if ((await unlockedTenant()) !== null) return null;
  return Response.json(
    {
      error: "no_shop_code",
      message: NO_SHOP_REPLY,
      // Shaped so a caller that only reads results still reads *empty* results
      // rather than undefined ones. A blind agent returns nothing, not junk.
      match: null,
      matches: [],
      results: [],
      suggestion: null,
      suggestions: [],
      steps: [],
    },
    { status: 403 },
  );
}
