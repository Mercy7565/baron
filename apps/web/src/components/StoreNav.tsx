"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  DoorOpen,
  House,
  LogOut,
  Package,
  PlugZap,
  Sparkles,
  Store,
  ShoppingBag,
  Wallet,
} from "lucide-react";

/**
 * The customer navigation.
 *
 * Icons rather than words, because eight text links across a dark bar read as a
 * list of settings; the same eight as marks read as a place. Every one keeps a
 * `title` for the browser's own tooltip and a visible label for a screen
 * reader, so nothing is lost by not spelling it out on screen.
 */

interface Item {
  href: string;
  label: string;
  Icon: typeof House;
}

const ITEMS: Item[] = [
  { href: "/home", label: "Home", Icon: House },
  { href: "/shop", label: "Shop", Icon: Store },
  { href: "/cart", label: "Cart", Icon: ShoppingBag },
  { href: "/agent", label: "Assistant", Icon: Sparkles },
  { href: "/wallet", label: "Wallet", Icon: Wallet },
  { href: "/orders", label: "Orders", Icon: Package },
  { href: "/connect-ai", label: "Connect AI", Icon: PlugZap },
];

/** One icon button. The label is the tooltip and the accessible name at once. */
function NavIcon({
  href,
  label,
  children,
  current = false,
  badge = null,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
  current?: boolean;
  badge?: number | null;
}) {
  return (
    <a
      className="st-navicon"
      href={href}
      title={label}
      aria-label={label}
      {...(current ? { "aria-current": "page" as const } : {})}
    >
      {children}
      {badge !== null && badge > 0 && <span className="st-navbadge">{badge}</span>}
      <span className="st-tip">{label}</span>
    </a>
  );
}

export function StoreNav() {
  const path = usePathname();
  const [count, setCount] = useState(0);
  const [inShop, setInShop] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // The bag count and the shop code both live on the server, and the shop
  // cookie is httpOnly, so the nav has to ask for both. It refreshes when the
  // tab regains focus rather than on a timer: neither number changes unless
  // the shopper does something.
  useEffect(() => {
    let alive = true;

    const load = (): void => {
      void fetch("/api/cart")
        .then((r) => r.json())
        .then((d: { cart?: { lines?: Array<{ qty: number }> } }) => {
          if (!alive) return;
          setCount((d.cart?.lines ?? []).reduce((n, l) => n + l.qty, 0));
        })
        .catch(() => {
          /* a missing count is not worth an error in the nav */
        });

      void fetch("/api/shop/code")
        .then((r) => r.json())
        .then((d: { unlocked?: boolean }) => {
          if (alive) setInShop(d.unlocked === true);
        })
        .catch(() => {
          /* likewise */
        });
    };

    load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, []);

  // Signing out returns to the dark stage, which is where a logged-out
  // visitor belongs.
  async function signOut(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  async function exitShop(): Promise<void> {
    setLeaving(true);
    try {
      await fetch("/api/shop/code", { method: "DELETE" });
      window.location.href = "/shop";
    } finally {
      setLeaving(false);
    }
  }

  return (
    <nav className="st-icons" aria-label="store">
      {ITEMS.map(({ href, label, Icon }) => (
        <NavIcon
          key={href}
          href={href}
          label={label}
          current={path === href}
          badge={href === "/cart" ? count : null}
        >
          <Icon size={21} strokeWidth={1.75} aria-hidden />
        </NavIcon>
      ))}

      {/* Only shown to someone who is actually inside a shop — there is
          nothing to leave otherwise. */}
      {inShop && (
        <button
          className="st-navicon"
          title="Exit shop"
          aria-label="Exit shop"
          disabled={leaving}
          onClick={() => void exitShop()}
        >
          <DoorOpen size={21} strokeWidth={1.75} aria-hidden />
          <span className="st-tip">Exit shop</span>
        </button>
      )}

      <button
        className="st-navicon"
        title="Sign out"
        aria-label="Sign out"
        onClick={() => void signOut()}
      >
        <LogOut size={21} strokeWidth={1.75} aria-hidden />
        <span className="st-tip">Sign out</span>
      </button>
    </nav>
  );
}
