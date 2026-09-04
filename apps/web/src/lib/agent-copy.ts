/**
 * Sentences the assistant says, kept where both sides can read them.
 *
 * `server/shop-code.ts` reaches for `next/headers`, so a client component
 * cannot import from it. This module holds only strings and imports nothing,
 * which is what lets the route and the transcript say the identical thing.
 */

/**
 * What the assistant says when it has no shop to look in.
 *
 * Professional, one line, and deliberately naming no product: an agent that
 * cannot see a catalog must not guess at what might be on it, because a
 * plausible-sounding suggestion from an empty shelf is exactly the invented
 * purchase the rest of this system exists to prevent.
 */
export const NO_SHOP_REPLY = "Enter a shop code first. I can only search the store you're in.";
