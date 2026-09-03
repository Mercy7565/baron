import { resolveSku } from "@/server/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/agent/resolve?q=…
 *
 * Turn a shopper's words into one product, or nothing.
 *
 * This exists because the assistant was calling `/api/catalog/search`, which
 * ranks every product by loose similarity and always returns its best guess.
 * Asked for "totally fake unicorn cream" it answered "Peptide Eye Cream" — a
 * substitution nobody asked for, on the way to spending money. `resolveSku`
 * applies a confidence bar instead: no confident match, no product.
 */
export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.trim() === "") return Response.json({ match: null });

  const hit = resolveSku(q);
  return Response.json({
    match: hit === null ? null : { id: hit.id, title: hit.title, price_paise: hit.price_paise },
  });
}
