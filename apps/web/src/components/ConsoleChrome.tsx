import type { ReactNode } from "react";

import { Logo } from "./Logo";
import { LogoutButton } from "./LogoutButton";

const NAV: Array<[string, string]> = [
  ["/merchant", "Overview"],
  ["/merchant/orders", "Orders"],
  ["/merchant/catalog", "Catalog"],
  ["/merchant/campaigns", "Campaigns"],
  ["/merchant/audit", "Audit"],
];

/** The merchant surface: dark rail, dense type, tables and meters. */
export function ConsoleChrome({ current, children }: { current: string; children: ReactNode }) {
  return (
    <div data-surface="console">
      <div className="mc-layout">
        <aside className="mc-rail">
          <div style={{ padding: "0 10px 8px" }}>
            <Logo href="/merchant" height={22} />
          </div>
          <div className="tag">Merchant console</div>
          {NAV.map(([href, label]) => (
            <a
              key={href}
              className="item"
              href={href}
              aria-current={current === href ? "page" : undefined}
            >
              {label}
            </a>
          ))}
          <div className="foot">
            <LogoutButton />
            <div style={{ marginTop: 10 }}>Razorpay test mode</div>
          </div>
        </aside>
        <main className="mc-main">{children}</main>
      </div>
    </div>
  );
}
