import { payable, readBasket } from "@/server/cart";
import { enteredCode } from "@/server/shop-code";
import { requireShopCode } from "@/server/shop-code";
import { suggestForCart } from "@/server/suggest";
import { hydrateOverlay } from "@/server/overlay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/agent/notify
 *
 * Up to three ranked suggestions, drawn only from curated catalog edges. It
 * adds nothing to the basket — the shopper accepts or rejects first.
 */
export async function POST(request: Request): Promise<Response> {
  // Merchant state is durable and shared; pull it into this instance
  // before anything reads a campaign, a catalog edit or the margin floor.
  await hydrateOverlay();

  const blind = await requireShopCode();
  if (blind !== null) return blind;

  let body: { cart_id?: string } = {};
  try {
    body = (await request.json()) as { cart_id?: string };
  } catch {
    // No body is fine; the demo cart is the default.
  }

  const lines = payable(await readBasket(await enteredCode()));
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
