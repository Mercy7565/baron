import { describe, expect, it } from "vitest";

import { GET } from "@/app/well-known/openai-openapi.yaml/route";

/**
 * The Action schema, held to ChatGPT's importer rather than to the spec.
 *
 * Each of the importer's rules rejects the whole file rather than the offending
 * field — so a schema that reads fine and validates fine can still fail to
 * import, which is exactly what happened. It has also changed its mind once:
 * 3.1 was refused and 3.0.x demanded, then 3.1.0 or 3.1.1 required. The other
 * rules held throughout — `components.schemas` must be a real object, and
 * descriptions are capped at 300 characters.
 *
 * These are cheap assertions against an expensive failure. The schema is only
 * ever exercised by a machine we do not control, so nothing here can be
 * discovered by looking at the page.
 */

const schema = async (): Promise<string> => {
  const res = GET(new Request("https://baron-shop.vercel.app/.well-known/openai-openapi.yaml"));
  return res.text();
};

/** Every `description:` value in the document, with its line for reporting. */
function descriptions(yaml: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  yaml.split("\n").forEach((raw, i) => {
    const m = /^\s*description:\s*(.+?)\s*$/.exec(raw);
    if (m?.[1] !== undefined) out.push({ text: m[1], line: i + 1 });
  });
  return out;
}

describe("the Custom GPT action schema", () => {
  it("is OpenAPI 3.1.x, which is what the importer now requires", async () => {
    expect(await schema()).toMatch(/^openapi: 3\.1\.[01]$/m);
  });

  it("uses 3.1 type unions rather than the 3.0 nullable keyword", async () => {
    // `nullable` was removed in 3.1. Leaving it behind is silently meaningless
    // rather than an error, which is the worst way for a schema to be wrong.
    const yaml = await schema();
    expect(yaml).not.toContain("nullable:");
    expect(yaml).toMatch(/type: \[\w+, 'null'\]/);
  });

  it("declares components.schemas as a real object", async () => {
    const yaml = await schema();
    const components = yaml.slice(yaml.indexOf("\ncomponents:"));

    expect(components).toContain("\n  schemas:");
    // An object with actual members, not an empty map — "is not an object" was
    // the importer's complaint when the key was absent entirely.
    expect(components).toMatch(/\n {4}[A-Za-z]\w*:\n {6}type: object/);
  });

  it("keeps every description under the importer's cap", async () => {
    const over = descriptions(await schema()).filter((d) => d.text.length > 280);
    expect(over.map((d) => `line ${d.line}: ${d.text.length} chars`)).toEqual([]);
  });

  it("keeps every operation", async () => {
    const yaml = await schema();
    for (const op of [
      "resolve_shop_code",
      "search_catalog",
      "get_product",
      "create_quote",
      "get_quote",
      "pay_quote",
      "get_payment",
      "suggest_add_on",
    ]) {
      expect(yaml).toContain(`operationId: ${op}`);
    }
  });

  it("keeps the shopper header as the security scheme", async () => {
    expect(await schema()).toContain("name: x-baron-shopper");
  });

  it("carries no markdown, which the importer renders as literal text", async () => {
    // Folded blocks were how the long descriptions got long in the first place.
    for (const d of descriptions(await schema())) {
      expect(d.text).not.toMatch(/^[|>]/);
      expect(d.text).not.toContain("**");
      expect(d.text).not.toContain("`");
    }
  });
});
