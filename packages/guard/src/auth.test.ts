import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../../..");
const WEB = join(REPO, "apps", "web", "src");

/**
 * The product split is the feature, so it is asserted structurally: a customer
 * must not be able to reach the merchant console, and vice versa.
 */
describe("role split", () => {
  const middleware = readFileSync(join(WEB, "middleware.ts"), "utf8");

  it("guards the merchant console and the campaigns console", () => {
    expect(middleware).toContain('"/merchant"');
    expect(middleware).toContain('"/campaigns"');
    expect(middleware).toContain("session.role === \"merchant\"");
  });

  it("guards the customer-only surfaces", () => {
    for (const path of ["/home", "/wallet", "/orders", "/agent", "/cart", "/shop", "/connect-ai"]) {
      expect(middleware).toContain(`"${path}"`);
    }
    expect(middleware).toContain("session.role === \"customer\"");
  });

  it("sends the wrong role to /login rather than rendering the page", () => {
    expect(middleware).toContain('new URL("/login"');
    expect(middleware).toContain("NextResponse.redirect");
  });

  it("matches every guarded route, so the guard cannot be skipped", () => {
    for (const path of [
      "/home",
      "/merchant",
      "/campaigns",
      "/wallet",
      "/orders",
      "/agent",
      "/cart",
      "/shop",
      "/connect-ai",
    ]) {
      expect(middleware).toContain(`${path}/:path*`);
    }
  });

  /**
   * The shop used to be public. It is not any more: a first visit has to pass
   * the stage and pick a role, so every page wearing customer chrome is behind
   * the customer guard. What stays open is the chrome-less surface — a product
   * page, the protocols page — and the machine endpoints, because an outside
   * agent carries a mandate rather than a cookie.
   */
  it("no page wearing customer chrome is reachable logged out", () => {
    for (const path of ["/home", "/shop", "/connect-ai"]) {
      expect(middleware).toContain(`"${path}"`);
    }
  });

  /**
   * The front door has to be the front door for everyone. `/` used to branch on
   * the session and render the customer home to anyone holding a cookie, so a
   * returning visitor never saw the stage again and there was no stable address
   * to send anyone to. The stage is now unconditional, and the customer home
   * lives at /home behind the customer guard.
   */
  it("never guards the stage, so / is reachable by anyone", () => {
    expect(middleware).not.toContain('"/"');
    expect(middleware).not.toContain('"/:path*"');
  });

  it("leaves the machine surface open, so an agent still needs no cookie", () => {
    expect(middleware).not.toContain('"/api"');
    expect(middleware).not.toContain('"/p"');
  });
});

describe("session cookie cannot be forged by hand", () => {
  const session = readFileSync(join(WEB, "server", "session.ts"), "utf8");

  it("is signed, and the signature is checked before the role is trusted", () => {
    expect(session).toContain("HMAC");
    // The comparison that stops a customer editing their cookie to "merchant".
    expect(session).toContain("if ((await sign(payload)) !== provided) return null;");
  });

  it("rejects any role that is not one of the two", () => {
    expect(session).toContain('parsed.role !== "customer" && parsed.role !== "merchant"');
  });
});

describe("surfaces are visually distinct", () => {
  it("each half declares its own surface, so a stranger can tell them apart", () => {
    const store = readFileSync(join(WEB, "components", "StoreChrome.tsx"), "utf8");
    const console_ = readFileSync(join(WEB, "components", "ConsoleChrome.tsx"), "utf8");

    expect(store).toContain('data-surface="store"');
    expect(console_).toContain('data-surface="console"');

    // The console has a rail; the store has a top nav. Not the same furniture.
    expect(console_).toContain("mc-rail");
    expect(store).toContain("st-nav");
  });

  it("the console never links a customer into the store checkout", () => {
    const console_ = readFileSync(join(WEB, "components", "ConsoleChrome.tsx"), "utf8");
    expect(console_).not.toContain('href="/cart"');
    expect(console_).not.toContain('href="/wallet"');
  });
});

/**
 * The Custom GPT instructions exist in two places: the block a user copies off
 * /connect-ai, and the same paragraph in docs/CUSTOM_GPT.md. They are supposed
 * to be the same words — the page even says so — but nothing was checking, and
 * they drifted: the doc still named the old brand and still told the model to
 * expect a `ready_to_pay` status the endpoint no longer returns.
 *
 * Whatever the GPT is told, it repeats to a shopper. That makes this copy
 * customer-facing, so it gets a test.
 */
describe("the pasted GPT instructions cannot drift from the docs", () => {
  const page = readFileSync(join(WEB, "app", "connect-ai", "page.tsx"), "utf8");
  const doc = readFileSync(join(REPO, "docs", "CUSTOM_GPT.md"), "utf8");

  const block = /const GPT_INSTRUCTIONS = `([\s\S]*?)`;/.exec(page)?.[1] ?? "";

  /** Markdown blockquote to plain text, and whitespace flattened. */
  const norm = (t: string): string =>
    t.replace(/`/g, "").replace(/\u2014/g, "-").replace(/\u2019/g, "'").replace(/\s+/g, " ").trim();

  const quoted = doc
    .split("\n")
    .map((l) => (l.startsWith("> ") ? l.slice(2) : l.trim() === ">" ? "" : "\u0000"))
    .join("\n");

  it("finds the instruction block on the page", () => {
    expect(block.length).toBeGreaterThan(200);
  });

  it("says exactly the same thing in the doc", () => {
    expect(norm(quoted)).toContain(norm(block));
  });

  it("never tells the model a link exists before one is generated", () => {
    expect(block).toContain("ready_to_generate");
    expect(block).not.toContain("ready_to_pay");
  });

  it("names Baron, never the old brand", () => {
    expect(block).toContain("Baron");
    expect(block.toLowerCase()).not.toContain("northlight");
  });
});
