import catalogJson from "@/data/catalog.json";

import type { Catalog } from "@countersign/catalog";

import { applyCatalogOverlay } from "@/server/overlay";

/**
 * The catalog feed, loaded once. Imported as JSON so it is bundled with the app
 * and served identically to the machine endpoints and the human pages — there
 * is exactly one source of truth for price, stock and margin.
 */
const BASE_CATALOG = catalogJson as Catalog;

/**
 * The catalog as the store currently sells it: the shipped file with any
 * merchant edits applied on top. Read through a getter so a console edit takes
 * effect on the next request without a restart.
 */
export const CATALOG: Catalog = new Proxy(BASE_CATALOG, {
  get(target, prop, receiver) {
    if (prop === "products") return applyCatalogOverlay(target).products;
    return Reflect.get(target, prop, receiver);
  },
});

/** Absolute base for URLs we hand to outside bots. */
export function baseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}
