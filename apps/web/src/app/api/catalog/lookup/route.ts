import { lookupSkus } from "@countersign/catalog";

import { CATALOG } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/catalog/lookup?ids=a,b
 *
 * Unknown ids come back in `not_found` rather than being silently dropped: an
 * agent that hallucinated a SKU should learn that here, not at the money path.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const raw = url.searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  const found = lookupSkus(CATALOG, ids);
  const foundIds = new Set(found.map((p) => p.id));

  return Response.json(
    {
      requested: ids,
      count: found.length,
      results: found,
      not_found: ids.filter((id) => !foundIds.has(id)),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
