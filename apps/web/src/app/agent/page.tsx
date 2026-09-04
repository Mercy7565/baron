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
      <p className="page-help">
        The assistant works inside one shop at a time. Enter a shop code and it can search, add to
        your basket and price it. It cannot set the price or invent a product.
      </p>
      <ShopAgent />
    </StoreChrome>
  );
}
