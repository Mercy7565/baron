import { CATALOG, baseUrl } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/catalog — the feed plus generation metadata. No auth, by design. */
export function GET(): Response {
  return Response.json(
    {
      ...CATALOG,
      generated_at: new Date().toISOString(),
      base_url: baseUrl(),
      endpoints: {
        search: "/api/catalog/search?q=",
        lookup: "/api/catalog/lookup?ids=a,b",
        raw_feed: "/catalog.json",
        profile: "/.well-known/countersign.json",
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
