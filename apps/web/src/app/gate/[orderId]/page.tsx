import { fetchOrder } from "@countersign/razorpay";
import { testCardDisplay } from "@countersign/vault";

import { CheckoutClient } from "./checkout-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const box: React.CSSProperties = {
  border: "1px solid var(--nl-mint-24)",
  padding: "8px",
  margin: "8px 0",
  fontFamily: "monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

export default async function GatePage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return (
      <main style={{ fontFamily: "monospace", padding: 16 }}>
        <h1>gate</h1>
        <div style={{ ...box, borderColor: "red" }}>Razorpay credentials are not configured.</div>
      </main>
    );
  }

  // Read the order back so the page shows what is actually being paid, rather
  // than what we hoped was created.
  const result = await fetchOrder({ keyId, keySecret }, orderId);

  if (!result.ok) {
    return (
      <main style={{ fontFamily: "monospace", padding: 16 }}>
        <h1>gate</h1>
        <div style={{ ...box, borderColor: "red" }}>
          could not load {orderId}: {result.error}
        </div>
      </main>
    );
  }

  const order = result.data;
  // Recurring-auth orders come back with no `offers` key at all, so undefined
  // is as ordinary here as null. Both mean "nothing attached".
  const offers = order.offers ?? [];
  const notes = order.notes as Record<string, string> | null;
  const offersMissing = offers.length === 0;

  return (
    <main style={{ fontFamily: "monospace", padding: 16, maxWidth: 900 }}>
      <h1>gate — {order.id}</h1>

      <div style={box}>
        amount: {order.amount} paise (₹{order.amount / 100}){"\n"}
        status: {order.status}
        {"\n"}
        receipt: {order.receipt ?? "(none)"}
      </div>

      <h2>attached offer id</h2>
      <div style={offersMissing ? { ...box, borderColor: "red" } : box}>
        {offersMissing ? "(none attached — this order will charge full price)" : offers.join(", ")}
      </div>

      <h2>notes</h2>
      <div style={box}>{JSON.stringify(notes, null, 2)}</div>

      <h2>pay</h2>
      <p>
        Test mode. Offers on this account are <b>card-only</b>, so UPI and netbanking will not
        apply the discount.
      </p>
      <div style={box}>
        {/* Sourced from the single vault constant, never written here. */}
        card: {testCardDisplay()}
        {"\n"}
        expiry: any future date · CVV: any 3 digits{"\n"}
        then choose Success on the simulated OTP screen
      </div>

      <CheckoutClient keyId={keyId} orderId={order.id} amountPaise={order.amount} />

      <p>
        <a href="/demo">← back to /demo</a>
      </p>
    </main>
  );
}
