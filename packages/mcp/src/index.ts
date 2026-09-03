/**
 * @countersign/mcp
 *
 * An MCP stdio server exposing the CounterSign tools.
 *
 * Two hard rules, both structural rather than aspirational:
 *   1. This package must never import @countersign/razorpay. There is a test
 *      that greps for it.
 *   2. Every tool reaches the app over HTTP, hitting the same routes an outside
 *      bot would. MCP is a transport, not a back door — propose_money_action
 *      goes through /api/checkout/propose like everything else.
 *
 * Implemented as raw JSON-RPC over stdio with no SDK, so the package stays
 * dependency-free and needs no install step.
 */

export const MCP_VERSION = "0.1.0" as const;

const BASE_URL = process.env.COUNTERSIGN_BASE_URL ?? "http://localhost:3000";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "search_catalog",
    description:
      "Search the merchant catalog. Returns only SKUs that exist; never invents a product.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search over titles, categories, attributes" },
        limit: { type: "number", description: "Max results, default 5" },
      },
      required: ["query"],
    },
  },
  {
    name: "lookup_skus",
    description:
      "Look up specific SKU ids. Unknown ids come back under not_found rather than being silently dropped.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
    },
  },
  {
    name: "get_cart",
    description: "Read the current demo cart, priced from the catalog.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_campaigns",
    description:
      "List merchant campaigns. Campaigns are hints only — they carry no offer ids and grant nothing.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_intent_mandate",
    description:
      "Mint an AP2-shaped demo IntentMandate and return its hash. Required before any money action; without one, propose_money_action answers HTTP 402.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "propose_money_action",
    description:
      "Propose a purchase. The merchant kernel decides ALLOW/CLAMP/REJECT/ESCALATE. Asking for more discount than policy allows is clamped to a legal offer, never granted. Requires mandate_hash.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { sku_id: { type: "string" }, qty: { type: "number" } },
            required: ["sku_id", "qty"],
          },
        },
        requested_discount_bps: { type: "number", description: "Basis points, e.g. 1500 for 15%" },
        mandate_hash: { type: "string" },
        campaign_id: { type: "string" },
      },
      required: ["items", "mandate_hash"],
    },
  },
];

async function http(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = text;
  }
  // A 402 is a real answer, not a transport failure — hand it back intact.
  return { status: res.status, body };
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search_catalog": {
      const q = encodeURIComponent(String(args.query ?? ""));
      const limit = Number(args.limit ?? 5);
      return http(`/api/catalog/search?q=${q}&limit=${limit}`);
    }
    case "lookup_skus": {
      const ids = Array.isArray(args.ids) ? args.ids.join(",") : "";
      return http(`/api/catalog/lookup?ids=${encodeURIComponent(ids)}`);
    }
    case "get_cart":
      return http("/api/cart");
    case "list_campaigns":
      return http("/api/campaigns");
    case "create_intent_mandate":
      return http("/api/mandates/demo", { method: "POST" });
    case "propose_money_action":
      return http("/api/checkout/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cart_id: "mcp_session",
          lines: args.items ?? [],
          currency: "INR",
          requested_discount_bps: Number(args.requested_discount_bps ?? 0),
          requested_offer_id: null,
          quoted_amount_paise: null,
          free_text: null,
          claimed_attributes: {},
          campaign_id: args.campaign_id ?? null,
          mandate_hash: args.mandate_hash ?? null,
        }),
      });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(req: JsonRpcRequest): Promise<void> {
  const { id, method, params } = req;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "countersign", version: MCP_VERSION },
      },
    });
    return;
  }

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const args = (params?.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await callTool(name, args);
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    } catch (err) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        },
      });
    }
    return;
  }

  // Notifications have no id and expect no response.
  if (id !== undefined && id !== null) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  }
}

/** Read newline-delimited JSON-RPC from stdin until the stream closes. */
export function main(): void {
  let buffer = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line !== "") {
        try {
          void handle(JSON.parse(line) as JsonRpcRequest);
        } catch {
          // A malformed line is skipped rather than killing the server.
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
}
