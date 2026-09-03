import { ShopAgent } from "@/components/ShopAgent";

import { StoreChrome } from "@/components/StoreChrome";

export const dynamic = "force-dynamic";

export default function AgentPage() {
  return (
    <StoreChrome>
      <h1 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 34 }}>Shop with an agent</h1>
      <p className="nl-sub" style={{ marginBottom: "var(--space-3)" }}>
        Tell it what you want. It can search, add to the basket, suggest, quote and pay — and it
        cannot charge you a rupee the store has not already agreed to.
      </p>
      <ShopAgent />
    </StoreChrome>
  );
}
