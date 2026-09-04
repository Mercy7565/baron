import { KeyRound } from "lucide-react";

import { ShopCodeForm } from "@/components/ShopCodeForm";

/**
 * The door into a merchant's shop.
 *
 * Baron is a platform, so a shopper does not simply arrive at a catalog: they
 * arrive at Baron and then name the shop they were given. The gate is what
 * makes that real rather than implied — without a valid code there is no
 * product grid to look at.
 */
export function ShopCodeGate() {
  return (
    <div className="st-card sc-gate">
      <KeyRound size={22} strokeWidth={1.75} aria-hidden />
      <h2>Enter a shop code</h2>
      <p className="st-muted">
        Merchants hand out a code once their catalog is live. Ask the shop you want to buy from, or
        use <code>BARON-SKIN</code> for the demo store.
      </p>

      <ShopCodeForm autoFocus />
    </div>
  );
}
