import { StoreChrome } from "@/components/StoreChrome";

import { CartClient } from "./CartClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The basket.
 *
 * Wrapped in the store chrome like every other customer page. It used to render
 * a bare `nl-shell` with no nav at all, which meant a shopper who landed here
 * had no way back to the shop, the agent or their orders except the browser
 * button — a dead end in the middle of the buying flow.
 */
export default function CartPage() {
  return (
    <StoreChrome>
      <h1>Your basket</h1>
      <p className="st-lede">Your coupon is applied at checkout, based on what is in your bag.</p>
      <p className="page-help">
        Your coupon is worked out from the whole basket, so it can change as you add or remove
        items. The total you see here is the total you pay.
      </p>
      <CartClient />
    </StoreChrome>
  );
}
