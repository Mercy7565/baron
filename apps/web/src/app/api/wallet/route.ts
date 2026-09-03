import { maskToken, saveCard, storedToken } from "@countersign/vault";

import { WALLET_TRUTH } from "@/lib/copy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUYER = "demo";

/** GET /api/wallet — what is on file. Never a PAN, never a token id. */
export function GET(): Response {
  const token = storedToken(BUYER);
  return Response.json({
    saved: token !== null,
    // Only ever the mask and the brand.
    card: token === null ? null : { display: maskToken(token), brand: token.brand },
  });
}

/**
 * POST /api/wallet
 *
 * The PAN and CVV enter this handler, are passed straight to the vault, and are
 * never returned, logged or written anywhere. The response carries only a mask.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { pan?: string; cvv?: string; expiry?: string; name?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const result = saveCard({
    buyer_user_id: BUYER,
    pan: String(body.pan ?? ""),
    cvv: String(body.cvv ?? ""),
    expiry: String(body.expiry ?? ""),
    name: String(body.name ?? ""),
  });

  if (!result.ok || result.token === null) {
    return Response.json({ ok: false, error: result.error }, { status: 400 });
  }

  return Response.json({
    ok: true,
    card: { display: maskToken(result.token), brand: result.token.brand },
    note: WALLET_TRUTH,
  });
}
