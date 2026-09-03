"use client";

import { useState } from "react";

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  handler: (response: Record<string, string>) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
  open: () => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckout(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay !== undefined) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    if (existing !== null) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("checkout.js failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("checkout.js failed to load"));
    document.body.appendChild(script);
  });
}

const box: React.CSSProperties = {
  border: "1px solid var(--nl-mint-24)",
  padding: "8px",
  margin: "8px 0",
  fontFamily: "monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

export function CheckoutClient({
  keyId,
  orderId,
  amountPaise,
}: {
  keyId: string;
  orderId: string;
  amountPaise: number;
}) {
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pay(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await loadCheckout();
      const Razorpay = window.Razorpay;
      if (Razorpay === undefined) throw new Error("Razorpay checkout unavailable");

      const rzp = new Razorpay({
        key: keyId,
        order_id: orderId,
        amount: amountPaise,
        currency: "INR",
        name: "CounterSign",
        description: `order ${orderId}`,
        handler: (response) => {
          setResult(response);
          setBusy(false);
        },
        modal: {
          ondismiss: () => setBusy(false),
        },
      });
      rzp.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={() => void pay()} disabled={busy} style={{ padding: "8px 16px" }}>
        {busy ? "checkout open…" : "Pay with Razorpay"}
      </button>

      {error !== null && <div style={{ ...box, borderColor: "red" }}>{error}</div>}

      {result !== null && (
        <>
          <h2>payment result</h2>
          <div style={box}>{JSON.stringify(result, null, 2)}</div>
          <p>
            Signature verification happens in the webhook at{" "}
            <code>/api/webhooks/razorpay</code>, not here.
          </p>
        </>
      )}
    </>
  );
}
