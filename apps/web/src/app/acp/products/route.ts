import { CATALOG, baseUrl } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /acp/products — alias of /api/catalog, under the ACP-shaped namespace. */
export function GET(): Response {
  return Response.json(
    { ...CATALOG, generated_at: new Date().toISOString(), base_url: baseUrl() },
    { headers: { "cache-control": "no-store" } },
  );
}
