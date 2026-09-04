/**
 * Product copy that has to be exactly right.
 *
 * The wallet sentence is a factual claim about what this build does with a
 * stored card. It lives here so the API and the UI cannot drift apart, and so
 * a test can assert it verbatim.
 */
export const WALLET_TRUTH =
  "Saved for a future server charge. Today you pay the link.";

/** The line that stops anyone reading a stored card as a charged card. */
export const WALLET_HEADLINE = "Card stays here. The assistant never sees it.";

/** Small print under the saved card. */
export const WALLET_FINE = "Black tape on the card. Policy on the price.";

/** What actually happens at the end of an agent purchase. */
export const CAPTURE_TRUTH =
  "When Razorpay allows server charge, this vault is ready. Until then, the payment link is the till.";

/**
 * The line under a saved card.
 *
 * Says what happens today and what changes when the account gets
 * server-to-server charge — in the future tense, because it does not work yet
 * and pretending otherwise is the one thing this product must never do.
 */
export const WALLET_NOTE =
  "Your card stays here and is never shown to the assistant. Today you pay each order on Razorpay. If server-to-server charge is enabled later, Baron will charge this card once the store has approved the order.";
