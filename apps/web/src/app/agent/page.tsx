import { ShopAgent } from "@/components/ShopAgent";
import { StoreChrome } from "@/components/StoreChrome";

export const dynamic = "force-dynamic";

export default function AgentPage() {
  return (
    <StoreChrome>
      <h1>Shop with an assistant</h1>
      <p className="st-lede">
        Tell it what you want. It can search, add to the basket, suggest and quote — and it cannot
        charge you a rupee the store has not already agreed to.
      </p>
      <p className="judge-note">
        The assistant is scoped to one shop. Without a shop code it will not search, add, suggest,
        quote or pay, because an agent that cannot see a catalog has nothing honest to say about
        what is on it.
      </p>
      <ShopAgent />
    </StoreChrome>
  );
}
