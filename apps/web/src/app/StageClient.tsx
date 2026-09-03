"use client";

import { useState } from "react";

import { Logo } from "@/components/Logo";

type Role = "customer" | "merchant";

/**
 * The stage.
 *
 * Every visit to `/` lands here, signed in or not. No shop, no nav, no product
 * grid — just the claim and two doors. A visitor picks a role before any of the
 * product exists for them, which is what stops a customer wandering into the
 * merchant console.
 *
 * `signedInAs` only changes the wording and saves a round trip: someone already
 * holding that role walks straight through, and someone holding the other one
 * swaps role on the way. The layout is the same either way, because the point
 * of a front door is that it looks like the front door every time.
 */
export function StageClient({ signedInAs = null }: { signedInAs?: Role | null }) {
  const [busy, setBusy] = useState<Role | null>(null);

  async function enter(role: Role, landing: string): Promise<void> {
    setBusy(role);
    try {
      // Already this role? Nothing to issue — just go.
      if (signedInAs !== role) {
        await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: role === "merchant" ? "owner@store.test" : "shopper@example.com",
            role,
          }),
        });
      }
      window.location.href = landing;
    } finally {
      setBusy(null);
    }
  }

  const label = (role: Role, verb: string): string => {
    if (busy === role) return "Entering…";
    return signedInAs === role ? `Continue as ${role} →` : verb;
  };

  return (
    <div data-surface="stage">
      <div className="sg-top">
        <Logo height={30} />
        <a className="login" href="/login">
          {signedInAs === null ? "Login / Signup" : "Switch account"}
        </a>
      </div>

      <div className="sg-body">
        {/* The stage carries one line, and it is this one. "Buy with a
            sentence. Pay with a rule." belongs to the customer home, after a
            role has been chosen — saying both here spends the pitch twice. */}
        <h1 className="sg-quote">
          We let the model talk. <em>We don&rsquo;t let it bill.</em>
        </h1>

        <div className="sg-doors">
          <button
            className="sg-door"
            disabled={busy !== null}
            onClick={() => void enter("customer", "/home")}
          >
            <div className="k">{signedInAs === "customer" ? "You are here" : "I want to buy"}</div>
            <h2>As a customer</h2>
            <p>
              Browse the shop, tell the agent what you want, answer one question, and pay a Razorpay
              link.
            </p>
            <div className="go">{label("customer", "Enter the shop →")}</div>
          </button>

          <button
            className="sg-door"
            disabled={busy !== null}
            onClick={() => void enter("merchant", "/merchant")}
          >
            <div className="k">{signedInAs === "merchant" ? "You are here" : "I run the store"}</div>
            <h2>As a merchant</h2>
            <p>
              Set catalog prices and campaign budgets, watch the orchestrator decide, and read every
              money decision in the ledger.
            </p>
            <div className="go">{label("merchant", "Open the console →")}</div>
          </button>
        </div>
      </div>

      <div className="sg-foot">
        {/* The protocol page is for a judge or an engineer, not a shopper or a
            merchant, so it hangs off the role screen rather than sitting in
            either console's navigation. */}
        <a className="sg-protocols" href="/protocols">
          How agents connect
        </a>
      </div>
    </div>
  );
}
