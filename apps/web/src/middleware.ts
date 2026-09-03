import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, decodeSession } from "@/server/session";

/**
 * Role routing.
 *
 * A customer opening the campaigns console is a product bug, so the split is
 * enforced here rather than by hiding links. Wrong role or logged out lands on
 * /login with a `next` hint.
 */

const MERCHANT_ONLY = ["/merchant", "/campaigns"];

/**
 * Every page that wears customer chrome.
 *
 * The rule is that nobody sees the shop until they have chosen to be a
 * customer, so this list is "what renders StoreChrome", not "what touches
 * money". /shop and /connect-ai were reachable logged out, which meant a first
 * visit could land in the store without ever passing the stage.
 *
 * Deliberately not listed: /p/:id and /protocols render no chrome, and the
 * machine endpoints under /api stay open because an outside agent has a
 * mandate, not a cookie.
 */
const CUSTOMER_ONLY = ["/home", "/wallet", "/orders", "/agent", "/cart", "/shop", "/connect-ai"];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const needsMerchant = matches(pathname, MERCHANT_ONLY);
  const needsCustomer = matches(pathname, CUSTOMER_ONLY);
  if (!needsMerchant && !needsCustomer) return NextResponse.next();

  const session = await decodeSession(request.cookies.get(SESSION_COOKIE)?.value);

  const allowed =
    session !== null &&
    ((needsMerchant && session.role === "merchant") ||
      (needsCustomer && session.role === "customer"));

  if (allowed) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  login.searchParams.set("need", needsMerchant ? "merchant" : "customer");
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/home/:path*",
    "/merchant/:path*",
    "/campaigns/:path*",
    "/wallet/:path*",
    "/orders/:path*",
    "/agent/:path*",
    "/cart/:path*",
    "/shop/:path*",
    "/connect-ai/:path*",
  ],
};
