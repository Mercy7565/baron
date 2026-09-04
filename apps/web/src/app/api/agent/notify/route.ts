import { DEMO_CART_ID, payableLines } from "@/server/cart";
import { requireShopCode } from "@/server/shop-code";
import { suggestForCart } from "@/server/suggest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/agent/notify
 *
 * Up to three ranked suggestions, drawn only from curated catalog edges. It
 * adds nothing to the basket — the shopper accepts or rejects first.
 */
export async function POST(request: Request): Promise<Response> {
  const blind = await requireShopCode();
  if (blind !== null) return blind;

  let body: { cart_id?: string } = {};
  try {
    body = (await request.json()) as { cart_id?: string };
  } catch {
    // No body is fine; the demo cart is the default.
  }

  const lines = payableLines(body.cart_id ?? DEMO_CART_ID);
  if (lines.length === 0) {
    return Response.json({ suggestions: [], suggestion: null, reason: "cart is empty" });
  }

  // Up to two, never the same SKU twice, each grounded in paid history, a
  // bigger coupon the kernel would actually grant, or stock that is not moving.
  const suggestions = suggestForCart(lines);

  return Response.json({
    suggestions,
    // Kept for the existing single-suggestion callers.
    suggestion: suggestions[0] ?? null,
    campaign_id: suggestions[0]?.campaign_id ?? null,
    campaign_name: suggestions[0]?.campaign_name ?? null,
    reason:
      suggestions.length > 0
        ? "grounded in paid pairs, a bigger allowed coupon, or slow stock"
        : "nothing would improve this basket without breaking the margin floor",
  });
}
