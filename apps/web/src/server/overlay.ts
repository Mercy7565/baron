import { readRecord, writeRecord } from "@/server/store";

import type { Campaign } from "@countersign/campaigns";
import type { Catalog, Product } from "@countersign/catalog";

/**
 * Merchant edits, kept as an overlay.
 *
 * The base catalog and campaign files are the shipped source of truth and are
 * never rewritten — a merchant fiddling with a price in the console must not be
 * able to destroy the seed data the demo depends on. Edits land in
 * `.data/merchant_overlay.json` and are applied on read.
 */

export interface ProductOverlay {
  price_paise?: number;
  stock_qty?: number;
  blocked?: boolean;
  /** false marks the SKU out of stock without touching its count. */
  active?: boolean;
}

export interface CampaignOverlay {
  spend_ceiling_paise?: number;
  spent_paise?: number;
  active?: boolean;
  /** A cancelled seed campaign is finished, not merely paused. */
  cancelled?: boolean;
}

/**
 * Policy knobs a merchant may turn from the console.
 *
 * Only the margin floor for now, and deliberately only the margin floor: it is
 * the one number that decides whether a coupon can ever apply, so leaving it
 * hardcoded meant a merchant could watch every basket clear 2% and have no way
 * to do anything about it.
 */
export interface PolicyOverlay {
  margin_floor_bps?: number;
}

/**
 * A campaign a merchant created in the console.
 *
 * Kept beside the shipped ones rather than merged into the seed file, so the
 * demo data stays intact and a merchant's own campaigns can be listed, paused
 * and deleted without touching it.
 */
export interface CreatedCampaign {
  id: string;
  name: string;
  kind: "bought_together" | "save_more" | "bogo";
  trigger_sku_ids: string[];
  reward_sku_id: string | null;
  /** A cap the merchant suggests. The kernel may grant less; never more. */
  suggested_bps: number;
  budget_paise: number;
  starts_at: string;
  ends_at: string;
  active: boolean;
  /**
   * Cancelled is not paused.
   *
   * A paused campaign is coming back, so it keeps its place in the list and its
   * budget. A cancelled one is finished: it leaves the Live list, never
   * suggests again and never spends again. Its paid history stays, because
   * those sales really happened.
   */
  cancelled?: boolean;
}

/** A product a merchant added in the console. */
export interface CreatedProduct {
  id: string;
  title: string;
  price_paise: number;
  stock_qty: number;
  margin_bps: number;
  on_sale: boolean;
  blocked: boolean;
  image: string;
}

export interface Overlay {
  version: 1;
  /**
   * Payments already charged to a campaign, as `payment_id|campaign_id`.
   *
   * Idempotency lives here rather than in memory because the refresh endpoint
   * is polled and the process restarts: a campaign must be charged once per
   * payment, not once per poll.
   */
  burned?: string[];
  products: Record<string, ProductOverlay>;
  campaigns: Record<string, CampaignOverlay>;
  policy?: PolicyOverlay;
  created_campaigns?: CreatedCampaign[];
  created_products?: CreatedProduct[];
}

const EMPTY: Overlay = { version: 1, products: {}, campaigns: {}, policy: {}, burned: [] };

/** The key this overlay lives under in the durable store. */
const KEY = "merchant_overlay";

/**
 * The overlay, cached for this process.
 *
 * Every accessor below is synchronous, and they are called from deep inside
 * pricing, the recommender and two Proxy getters — making them async would
 * reach about forty files. So the shape is a cache: `hydrateOverlay()` pulls
 * the durable copy in at the top of a request, and the sync readers work off
 * what it left behind.
 *
 * A cold instance that reads before hydrating sees the shipped defaults, which
 * is what it saw before any of this existed: stale, never wrong.
 */
const globalForOverlay = globalThis as typeof globalThis & {
  __baron_overlay?: Overlay;
  __baron_overlay_at?: number;
};

/** How long a hydrated copy is trusted before another instance's write matters. */
const CACHE_MS = 5_000;

function normalise(parsed: Partial<Overlay> | null): Overlay {
  if (parsed === null) return { ...EMPTY };
  return {
    version: 1,
    products: parsed.products ?? {},
    campaigns: parsed.campaigns ?? {},
    policy: parsed.policy ?? {},
    burned: parsed.burned ?? [],
    created_campaigns: parsed.created_campaigns ?? [],
    created_products: parsed.created_products ?? [],
  };
}

/**
 * Pull the durable overlay into this process.
 *
 * Called at the top of every entry point that reads or writes merchant state.
 * Cheap and idempotent: within `CACHE_MS` it does nothing, so a page that
 * hydrates and then calls six things that read the overlay pays once.
 */
export async function hydrateOverlay(force = false): Promise<Overlay> {
  const at = globalForOverlay.__baron_overlay_at ?? 0;
  const fresh = Date.now() - at < CACHE_MS;

  if (!force && fresh && globalForOverlay.__baron_overlay !== undefined) {
    return globalForOverlay.__baron_overlay;
  }

  const loaded = await readRecord<Partial<Overlay> | null>(KEY, null);
  const overlay = normalise(loaded);

  globalForOverlay.__baron_overlay = overlay;
  globalForOverlay.__baron_overlay_at = Date.now();
  return overlay;
}

export function readOverlay(): Overlay {
  return globalForOverlay.__baron_overlay ?? { ...EMPTY };
}

/**
 * Update the cache now, persist in the background.
 *
 * The rest of this request sees the change immediately. A merchant route that
 * needs to tell the truth about whether it saved should await
 * `persistOverlay()` instead.
 */
function writeOverlay(overlay: Overlay): void {
  globalForOverlay.__baron_overlay = overlay;
  globalForOverlay.__baron_overlay_at = Date.now();
  void writeRecord(KEY, overlay);
}

/** Await the durable write, and report whether it actually landed. */
export async function persistOverlay(): Promise<boolean> {
  const overlay = readOverlay();
  globalForOverlay.__baron_overlay_at = Date.now();
  return await writeRecord(KEY, overlay);
}

export function setProductOverlay(id: string, patch: ProductOverlay): Overlay {
  const overlay = readOverlay();
  overlay.products[id] = { ...overlay.products[id], ...patch };
  writeOverlay(overlay);
  return overlay;
}

export function setCampaignOverlay(id: string, patch: CampaignOverlay): Overlay {
  const overlay = readOverlay();
  overlay.campaigns[id] = { ...overlay.campaigns[id], ...patch };
  writeOverlay(overlay);
  return overlay;
}

/**
 * Set the margin floor.
 *
 * Clamped to 0-4000 bps here rather than trusted from the request: a negative
 * floor would let a discount eat past cost, and a floor above 40% would refuse
 * every coupon in the catalogue's margin range, which is a footgun rather than
 * a policy. Written to the same overlay the quote path reads on every request,
 * so a save takes effect on the next quote with no restart.
 */
export function setMarginFloorBps(bps: number): number {
  const clamped = Math.max(0, Math.min(4000, Math.round(bps)));
  const overlay = readOverlay();
  overlay.policy = { ...overlay.policy, margin_floor_bps: clamped };
  writeOverlay(overlay);
  return clamped;
}

/** The live margin floor: the merchant's edit if there is one, else the default. */
export function marginFloorBps(fallback: number): number {
  const stored = readOverlay().policy?.margin_floor_bps;
  return typeof stored === "number" && Number.isFinite(stored) ? stored : fallback;
}

/** Add a campaign the merchant built in the console. */
export function addCreatedCampaign(c: CreatedCampaign): CreatedCampaign {
  const overlay = readOverlay();
  const list = overlay.created_campaigns ?? [];
  overlay.created_campaigns = [...list.filter((x) => x.id !== c.id), c];
  writeOverlay(overlay);
  return c;
}

export function createdCampaigns(): CreatedCampaign[] {
  return readOverlay().created_campaigns ?? [];
}

/**
 * Charge a campaign for one payment, once.
 *
 * Returns false when this exact (payment, campaign) pair has already been
 * charged, so a polled refresh or a replayed webhook cannot double count. The
 * ledger of what has been burned is written in the same file as the spend, so
 * the two cannot disagree after a restart.
 */
export function burnOnce(paymentId: string, campaignId: string, paise: number): boolean {
  if (paise <= 0) return false;

  const overlay = readOverlay();
  const key = `${paymentId}|${campaignId}`;
  const burned = overlay.burned ?? [];
  if (burned.includes(key)) return false;

  const current = overlay.campaigns[campaignId]?.spent_paise ?? 0;
  overlay.campaigns[campaignId] = {
    ...overlay.campaigns[campaignId],
    spent_paise: current + Math.floor(paise),
  };
  overlay.burned = [...burned, key];
  writeOverlay(overlay);
  return true;
}

/**
 * Overwrite every campaign's spend with a reconciled set of totals.
 *
 * Used to repair a store written by a path that was charging the wrong place.
 * Campaigns absent from `totals` are set to zero, because "no paid order
 * justifies this" is a fact, not a gap.
 */
export function setReconciledSpend(totals: Record<string, number>, burned: string[]): void {
  const overlay = readOverlay();
  const ids = new Set([...Object.keys(overlay.campaigns), ...Object.keys(totals)]);

  for (const id of ids) {
    overlay.campaigns[id] = { ...overlay.campaigns[id], spent_paise: totals[id] ?? 0 };
  }
  overlay.burned = burned;
  writeOverlay(overlay);
}

/** Cancelled seed campaigns, so the Live list can exclude them. */
export function cancelledSeedIds(): Set<string> {
  const overlay = readOverlay();
  return new Set(
    Object.entries(overlay.campaigns ?? {})
      .filter(([, c]) => c.cancelled === true)
      .map(([id]) => id),
  );
}

export function setCampaignCancelled(id: string): void {
  const overlay = readOverlay();
  const created = overlay.created_campaigns ?? [];
  const mine = created.find((c) => c.id === id);

  if (mine !== undefined) {
    overlay.created_campaigns = created.map((c) =>
      c.id === id ? { ...c, cancelled: true, active: false } : c,
    );
  } else {
    overlay.campaigns[id] = { ...overlay.campaigns[id], cancelled: true, active: false };
  }
  writeOverlay(overlay);
}

/** Add a product the merchant listed in the console. */
export function addCreatedProduct(p: CreatedProduct): CreatedProduct {
  const overlay = readOverlay();
  const list = overlay.created_products ?? [];
  overlay.created_products = [...list.filter((x) => x.id !== p.id), p];
  writeOverlay(overlay);
  return p;
}

export function createdProducts(): CreatedProduct[] {
  return readOverlay().created_products ?? [];
}

/** Apply merchant edits to the shipped catalog. */
export function applyCatalogOverlay(base: Catalog): Catalog {
  const overlay = readOverlay();
  const created = overlay.created_products ?? [];

  if (Object.keys(overlay.products).length === 0 && created.length === 0) return base;

  // Products the merchant added, shaped like the shipped ones so every consumer
  // — pricing, guard, recommender — treats them identically.
  const extra: Product[] = created.map((c) => ({
    id: c.id,
    title: c.title,
    description: "Added from the merchant console.",
    brand: "Baron",
    category: ["skincare"],
    url: `/p/${c.id}`,
    price_paise: c.price_paise,
    currency: "INR",
    availability: c.on_sale && c.stock_qty > 0 ? "in_stock" : "oos",
    stock_qty: c.stock_qty,
    max_qty: 5,
    margin_bps: c.margin_bps,
    attributes: {},
    complements: [],
    upgrades: [],
    blocked: c.blocked,
    image: c.image,
    frequently_bought_with: [],
  }));

  const products: Product[] = [...base.products, ...extra].map((p) => {
    const edit = overlay.products[p.id];
    if (edit === undefined) return p;

    const stock = edit.stock_qty ?? p.stock_qty;
    // "active: false" is how a merchant takes something off sale without
    // pretending the warehouse is empty.
    const inactive = edit.active === false;

    return {
      ...p,
      price_paise: edit.price_paise ?? p.price_paise,
      stock_qty: stock,
      blocked: edit.blocked ?? p.blocked,
      availability: inactive || stock <= 0 ? "oos" : "in_stock",
    };
  });

  return { ...base, products };
}

export function applyCampaignOverlay(base: Campaign[]): Campaign[] {
  const overlay = readOverlay();
  if (Object.keys(overlay.campaigns).length === 0) return base;

  return base.map((c) => {
    const edit = overlay.campaigns[c.id];
    if (edit === undefined) return c;
    return {
      ...c,
      spend_ceiling_paise: edit.spend_ceiling_paise ?? c.spend_ceiling_paise,
      spent_paise: edit.spent_paise ?? c.spent_paise,
      // A cancelled campaign is inactive no matter what the active flag says.
      active: edit.cancelled === true ? false : (edit.active ?? c.active),
    };
  });
}
