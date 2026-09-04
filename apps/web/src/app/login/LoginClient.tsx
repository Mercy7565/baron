"use client";

import { useState } from "react";

type Role = "customer" | "merchant";

/**
 * Sign in, or create an account.
 *
 * Any username and password makes a new account — this is a demo, and the two
 * fixed logins below are printed on the page because a judge should never have
 * to guess a credential to see the product. The role split is the thing being
 * shown, so the form is honest about which side you are about to land on.
 */
export function LoginClient({ next, need }: { next: string | null; need: string | null }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(need === "merchant" ? "merchant" : "customer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      const d = (await res.json()) as { error?: string; role?: Role };
      if (!res.ok) {
        setError(d.error ?? "Could not sign you in.");
        return;
      }
      // Land where the account belongs, not where the form guessed.
      const landing = d.role === "merchant" ? "/merchant" : (next ?? "/home");
      window.location.href = landing;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
        {need !== null && (
          <p className="sg-quote-2" style={{ fontSize: 17, marginBottom: 22 }}>
            That page is for the <strong>{need}</strong> side of Baron. Sign in with that kind of
            account to continue.
          </p>
        )}

        <div className="lg-tabs">
          <button
            className={mode === "login" ? "lg-tab is-on" : "lg-tab"}
            onClick={() => setMode("login")}
          >
            Sign in
          </button>
          <button
            className={mode === "signup" ? "lg-tab is-on" : "lg-tab"}
            onClick={() => setMode("signup")}
          >
            Create account
          </button>
        </div>

        <form
          className="lg-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          {mode === "signup" && (
            <div className="lg-roles">
              <button
                type="button"
                className={role === "customer" ? "lg-role is-on" : "lg-role"}
                onClick={() => setRole("customer")}
              >
                I want to shop
              </button>
              <button
                type="button"
                className={role === "merchant" ? "lg-role is-on" : "lg-role"}
                onClick={() => setRole("merchant")}
              >
                I run a shop
              </button>
            </div>
          )}

          {error !== null && <p className="lg-error">{error}</p>}

          <button className="lg-submit" disabled={busy} type="submit">
            {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account and continue"}
          </button>
        </form>

        <div className="lg-demo">
          <strong>Demo accounts</strong>
          <div>
            merchant · <code>merchant</code> / <code>merchant</code> — the skincare shop already
            loaded
          </div>
          <div>
            shopper · <code>aryan</code> / <code>aryan</code>
          </div>
          <p>
            Any other username and password creates a new account. Baron never asks for your
            Razorpay keys.
          </p>
        </div>
    </>
  );
}
