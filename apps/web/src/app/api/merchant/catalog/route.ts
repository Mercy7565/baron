import { setProductOverlay, hydrateOverlay, persistOverlay } from "@/server/overlay";
import { requireRole } from "@/server/require-role";
import { durability } from "@/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/merchant/catalog — write one SKU edit into the overlay. */
export async function POST(request: Request): Promise<Response> {
  // Merchant state is durable and shared; pull it into this instance
  // before anything reads a campaign, a catalog edit or the margin floor.
  await hydrateOverlay();

  // Middleware guards pages, not APIs. Without this a logged-out curl could
  // edit the catalog.
  const auth = await requireRole("merchant");
  if (!auth.ok) return auth.response;

  let body: {
    sku_id?: string;
    price_paise?: number;
    stock_qty?: number;
    blocked?: boolean;
    active?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const id = String(body.sku_id ?? "");
  if (id === "") return Response.json({ error: "sku_id is required" }, { status: 400 });

  // Prices are integer paise. A float here would poison every total downstream.
  const price = Number(body.price_paise);
  if (!Number.isInteger(price) || price <= 0) {
    return Response.json({ error: "price_paise must be a positive integer" }, { status: 400 });
  }

  const stock = Number(body.stock_qty);
  if (!Number.isInteger(stock) || stock < 0) {
    return Response.json({ error: "stock_qty must be a non-negative integer" }, { status: 400 });
  }

  setProductOverlay(id, {
    price_paise: price,
    stock_qty: stock,
    blocked: body.blocked === true,
    active: body.active !== false,
  });

  const saved = await persistOverlay();
  return Response.json({ ok: true, sku_id: id, saved, storage: durability() });
}
