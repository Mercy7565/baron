import { searchCatalog } from "@countersign/catalog";

import { CATALOG } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/catalog/search?q= — only ever returns ids that exist in the feed. */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limitRaw = Number(url.searchParams.get("limit") ?? "10");
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 50 ? limitRaw : 10;

  const results = searchCatalog(CATALOG, q, limit);

  return Response.json(
    { query: q, count: results.length, results },
    { headers: { "cache-control": "no-store" } },
  );
}
