import type { ReactNode } from "react";

import { Logo } from "./Logo";
import { StoreNav } from "./StoreNav";

/** The customer surface: top nav, roomy type, no console furniture. */
export function StoreChrome({ children }: { children: ReactNode }) {
  return (
    <div data-surface="store" style={{ minHeight: "100vh" }}>
      <div className="st-shell">
        <header className="st-nav">
          <Logo href="/home" height={26} />
          {/* Every destination, and the two ways out — leaving the shop and
              signing out — as marks with tooltips rather than a row of words. */}
          <StoreNav />
        </header>
        <main className="st-page">{children}</main>
        <footer
          className="st-muted"
          style={{ margin: "72px 0 40px", paddingTop: 18, borderTop: "1px solid var(--line)" }}
        />
      </div>
    </div>
  );
}
