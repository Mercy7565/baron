import { addCreatedProduct, createdProducts, hydrateOverlay, persistOverlay } from "@/server/overlay";
import { requireRole } from "@/server/require-role";
import { durability } from "@/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/merchant/products
 *
 * List a new product. Overlay only — the shipped catalog file is never
 * rewritten, so the seed data a demo depends on cannot be destroyed by a typo
 * in the console. The product appears on /shop on the next request.
 */
function slug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  return `sku_${base === "" ? "product" : base}`;
}

export async function GET(): Promise<Response> {
  // Merchant state is durable and shared; pull it into this instance
  // before anything reads a campaign, a catalog edit or the margin floor.
  await hydrateOverlay();

  const auth = await requireRole("merchant");
  if (!auth.ok) return auth.response;
  return Response.json({ products: createdProducts() });
}

export async function POST(request: Request): Promise<Response> {
  // Every handler hydrates, not just the first one in the file: a POST
  // that appends to an unhydrated cache writes an overlay containing only
  // its own row, which silently deletes every campaign already there.
  await hydrateOverlay();

  const auth = await requireRole("merchant");
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const title = String(body.title ?? "").trim();
  if (title === "") return Response.json({ error: "name is required" }, { status: 400 });

  const price = Math.round(Number(body.price_paise ?? 0));
  if (!Number.isFinite(price) || price <= 0) {
    return Response.json({ error: "price must be greater than zero" }, { status: 400 });
  }

  const margin = Math.round(Number(body.margin_bps ?? 0));
  if (!Number.isFinite(margin) || margin < 0 || margin > 10_000) {
    return Response.json({ error: "margin must be between 0 and 100%" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim() !== "" ? String(body.id).trim() : slug(title);

  const created = addCreatedProduct({
    id,
    title,
    price_paise: price,
    stock_qty: Math.max(0, Math.round(Number(body.stock_qty ?? 0))),
    margin_bps: margin,
    on_sale: body.on_sale !== false,
    blocked: body.blocked === true,
    image: String(body.image ?? "").trim() || "/products/placeholder.svg",
  });

  const saved = await persistOverlay();
  return Response.json({ product: created, saved, storage: durability() });
}
