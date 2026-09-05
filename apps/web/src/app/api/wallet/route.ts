import { cookies } from "next/headers";

import { maskToken, saveCard, storedToken, type VaultToken } from "@countersign/vault";

import { WALLET_TRUTH } from "@/lib/copy";
import { cookieOptions, SHOPPING_MAX_AGE } from "@/server/cookie-options";
import { buyerId } from "@/server/require-role";
import { signValue, verifyValue } from "@/server/sign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The saved card, remembered in the shopper's own cookie.
 *
 * The vault writes its token file to `.data/wallet.json`, which on a serverless
 * host is `/tmp` — per instance, and gone on a cold start. A shopper saved a
 * card, came back, and the wallet was empty.
 *
 * A cookie is the right home for this and not merely a workaround: what is kept
 * is a *reference* to a card — a masked display, a brand and a token id — and it
 * belongs to one browser, not to the shop. Nothing here is a card number. The
 * PAN and CVV reach the vault inside a single request and are never written
 * anywhere, which is exactly as true now as it was before.
 *
 * Signed, so the mask and token id cannot be edited into someone else's.
 */
const WALLET_COOKIE = "baron_wallet";

/** Only the fields a browser may hold. A PAN is not one of them. */
interface StoredWallet {
  v: 1;
  token_id: string;
  last4: string;
  brand: string;
}

function toStored(token: VaultToken): StoredWallet {
  return {
    v: 1,
    token_id: token.token_id,
    last4: token.last4,
    brand: token.brand,
  };
}

function isStored(value: unknown): value is StoredWallet {
  if (typeof value !== "object" || value === null) return false;
  const w = value as Partial<StoredWallet>;
  return (
    w.v === 1 &&
    typeof w.token_id === "string" &&
    typeof w.last4 === "string" &&
    typeof w.brand === "string"
  );
}

async function fromCookie(): Promise<StoredWallet | null> {
  const jar = await cookies();
  const raw = jar.get(WALLET_COOKIE)?.value;
  if (raw === undefined || raw === "") return null;

  const payload = await verifyValue(raw);
  if (payload === null) return null;

  try {
    const parsed: unknown = JSON.parse(payload);
    return isStored(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** GET /api/wallet — what is on file. Never a PAN, never a token id. */
export async function GET(): Promise<Response> {
  const held = await fromCookie();
  if (held !== null) {
    return Response.json({
      saved: true,
      // Only ever the mask and the brand.
      card: { display: `•••• ${held.last4}`, brand: held.brand },
    });
  }

  // Falls back to the vault file, which is still the store on a laptop.
  const token = storedToken(await buyerId());
  return Response.json({
    saved: token !== null,
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
    buyer_user_id: await buyerId(),
    pan: String(body.pan ?? ""),
    cvv: String(body.cvv ?? ""),
    expiry: String(body.expiry ?? ""),
    name: String(body.name ?? ""),
  });

  if (!result.ok || result.token === null) {
    return Response.json({ ok: false, error: result.error }, { status: 400 });
  }

  // The reference, not the card. This is what survives a cold start.
  const jar = await cookies();
  jar.set(
    WALLET_COOKIE,
    await signValue(JSON.stringify(toStored(result.token))),
    cookieOptions(SHOPPING_MAX_AGE),
  );

  return Response.json({
    ok: true,
    card: { display: maskToken(result.token), brand: result.token.brand },
    note: WALLET_TRUTH,
  });
}

/** DELETE — forget the card on this browser. */
export async function DELETE(): Promise<Response> {
  const jar = await cookies();
  jar.delete(WALLET_COOKIE);
  return Response.json({ saved: false, card: null });
}
