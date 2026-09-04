import { describe, expect, it } from "vitest";

import type { Catalog } from "@countersign/catalog";

import catalogJson from "../data/catalog.json";
import { NO_SHOP_REPLY } from "../lib/agent-copy";

const CATALOG = catalogJson as Catalog;

/**
 * The blind assistant.
 *
 * The gate itself lives in a route handler and reads a cookie, so what is
 * pinned here is the part that has no runtime: the sentence the assistant says
 * when it cannot see a shop. It is the one string a shopper reads at the moment
 * the agent has no catalog, and it is exactly the moment an agent is most
 * tempted to guess.
 */
describe("the reply from a blind assistant", () => {
  it("names no product from the catalog", () => {
    const said = NO_SHOP_REPLY.toLowerCase();

    for (const p of CATALOG.products) {
      expect(said).not.toContain(p.title.toLowerCase());
      expect(said).not.toContain(p.id.toLowerCase());

      // Nor a distinctive word out of a product name. "Serum", "niacinamide"
      // and the rest are the vocabulary of a shop this browser cannot see.
      for (const word of p.title.toLowerCase().split(/[^a-z]+/)) {
        if (word.length < 5) continue;
        expect(said).not.toContain(word);
      }
    }
  });

  it("tells the shopper what to do about it", () => {
    // A refusal that does not say how to proceed is a dead end. The sentence
    // has to name the shop code, because that is the only thing that fixes it.
    expect(NO_SHOP_REPLY.toLowerCase()).toContain("shop code");
  });

  it("promises nothing beyond the shop the buyer is in", () => {
    expect(NO_SHOP_REPLY.toLowerCase()).toContain("the store you're in");
  });
});
