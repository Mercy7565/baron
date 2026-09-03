"use client";

import { useState } from "react";

type Role = "customer" | "merchant";

const ROLES: Array<{
  role: Role;
  title: string;
  blurb: string;
  lands: string;
  sample: string;
}> = [
  {
    role: "customer",
    title: "Customer",
    blurb: "Browse the shop, talk to the agent, and pay a Razorpay link.",
    lands: "/home",
    sample: "shopper@example.com",
  },
  {
    role: "merchant",
    title: "Merchant",
    blurb: "Run the store: catalog, campaign budgets, orchestrator, audit.",
    lands: "/merchant",
    sample: "owner@store.test",
  },
];

/**
 * Demo sign-in. Two equal choices, no password — the split is the product, and
 * making people invent credentials for a demo teaches nobody anything.
 */
export function LoginClient({ next, need }: { next: string | null; need: string | null }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(role: Role, landing: string): Promise<void> {
    setBusy(role);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim() === "" ? ROLES.find((x) => x.role === role)?.sample : email.trim(),
          role,
        }),
      });
      if (!r.ok) {
        const d = (await r.json()) as { error?: string };
        setError(d.error ?? "Could not sign in.");
        return;
      }
      // Land where they were headed, if that destination suits the role.
      const wantsMerchant = next !== null && (next.startsWith("/merchant") || next.startsWith("/campaigns"));
      const target =
        next !== null && ((role === "merchant") === wantsMerchant) ? next : landing;
      window.location.href = target;
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {need !== null && (
        <div
          style={{
            marginBottom: 20,
            padding: "14px 18px",
            borderRadius: 10,
            background: "var(--nl-mint-12)",
            border: "1px solid var(--nl-mint-24)",
            color: "var(--nl-mint)",
          }}
        >
          That page is for the <strong>{need}</strong> side of this site. Sign in with that role to
          continue.
        </div>
      )}

      <label style={{ display: "block", marginBottom: 20 }}>
        <span style={{ fontSize: 14, color: "var(--nl-mint)" }}>
          Email (optional for the demo)
        </span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{
            width: "100%",
            marginTop: 6,
            font: "inherit",
            padding: "12px 14px",
            border: "1px solid var(--nl-mint-24)",
            borderRadius: 10,
            background: "var(--nl-ink)",
            color: "var(--nl-mint)",
          }}
        />
      </label>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
        {ROLES.map((r) => (
          <div
            key={r.role}
            className="sg-door"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              cursor: "default",
              // Customer edge in green, merchant edge in amber: two doors, one family.
              borderColor: r.role === "customer" ? "var(--nl-green)" : "var(--nl-amber)",
            }}
          >
            <h2 style={{ margin: 0, fontSize: 21 }}>{r.title}</h2>
            <p style={{ margin: 0, fontSize: 15, flex: 1, color: "var(--nl-mint)" }}>
              {r.blurb}
            </p>
            <button
              className="st-btn"
              style={{
                fontSize: 15,
                padding: "11px 18px",
                background: r.role === "customer" ? "var(--nl-green)" : "var(--nl-amber)",
                borderColor: r.role === "customer" ? "var(--nl-green)" : "var(--nl-amber)",
                color: r.role === "customer" ? "#ffffff" : "var(--nl-ink)",
              }}
              disabled={busy !== null}
              onClick={() => void signIn(r.role, r.lands)}
            >
              {busy === r.role ? "Signing in…" : `Continue as ${r.title.toLowerCase()}`}
            </button>
          </div>
        ))}
      </div>

      {error !== null && (
        <p style={{ color: "var(--danger)", marginTop: 16 }}>{error}</p>
      )}

      <p style={{ fontSize: 13, marginTop: 22, textAlign: "center", color: "var(--nl-mint)" }}>
        Demo sign-in. No password, no OAuth — the role is what matters.
      </p>
    </>
  );
}
