import type { ReactNode } from "react";

import { CartNavLink } from "./CartNavLink";
import { Logo } from "./Logo";
import { LogoutButton } from "./LogoutButton";

/** The customer surface: top nav, roomy type, no console furniture. */
export function StoreChrome({ children }: { children: ReactNode }) {
  return (
    <div data-surface="store" style={{ minHeight: "100vh" }}>
      <div className="st-shell">
        <header className="st-nav">
          <Logo href="/home" height={26} />
          <nav aria-label="store">
            {/* Home is named explicitly, not just carried by the logo: a
                shopper deep in the basket should be able to see the way out. */}
            <a href="/home">Home</a>
            <a href="/shop">Shop</a>
            <CartNavLink />
            <a href="/agent">Agent</a>
            <a href="/wallet">Wallet</a>
            <a href="/orders">Orders</a>
            <a href="/connect-ai">Connect AI</a>
            <LogoutButton />
          </nav>
        </header>
        {children}
        <footer
          className="st-muted"
          style={{ margin: "72px 0 40px", paddingTop: 18, borderTop: "1px solid var(--line)" }}
        />
      </div>
    </div>
  );
}
