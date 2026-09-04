import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Megaphone,
  Package,
  ScrollText,
  Tag,
  type LucideIcon,
} from "lucide-react";

import { Logo } from "./Logo";
import { LogoutButton } from "./LogoutButton";

const NAV: Array<[string, string, LucideIcon]> = [
  ["/merchant", "Overview", LayoutDashboard],
  ["/merchant/orders", "Orders", Package],
  ["/merchant/catalog", "Catalog", Tag],
  ["/merchant/campaigns", "Campaigns", Megaphone],
  ["/merchant/audit", "Audit", ScrollText],
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
          {/* The rail keeps its words: a merchant lives here all day and a
              five-item sidebar has the room. The icons are a spine to scan
              down, not a replacement for the label. */}
          {NAV.map(([href, label, Icon]) => (
            <a
              key={href}
              className="item"
              href={href}
              aria-current={current === href ? "page" : undefined}
            >
              <Icon size={17} strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
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
