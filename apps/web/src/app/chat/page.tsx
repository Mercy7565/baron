import { CartClient } from "../cart/CartClient";

export const dynamic = "force-dynamic";

/** Alias of the cart drawer — same component, same cart, no second code path. */
export default function ChatPage() {
  return (
    <main>
      <h1>Chat</h1>
      <p className="cs-muted">
        The same agent and the same cart as <a href="/cart">/cart</a>.
      </p>
      <CartClient />
    </main>
  );
}
