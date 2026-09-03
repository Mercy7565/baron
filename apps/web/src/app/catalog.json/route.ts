import { CATALOG } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /catalog.json — the raw feed, nothing added. */
export function GET(): Response {
  return Response.json(CATALOG, { headers: { "cache-control": "no-store" } });
}
