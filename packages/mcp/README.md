# @countersign/mcp

MCP stdio server exposing the CounterSign tools to an outside agent.

It talks to the running app over HTTP only. It does not import
`@countersign/razorpay`, and it has no privileged path to money:
`propose_money_action` calls `POST /api/checkout/propose`, the same route an
outside bot or the in-app agent uses.

## Tools

| tool | what it does |
| --- | --- |
| `search_catalog` | Search the catalog. Only returns SKUs that exist. |
| `lookup_skus` | Resolve ids; unknown ones come back under `not_found`. |
| `get_cart` | Read the demo cart, priced from the catalog. |
| `list_campaigns` | List campaigns. Hints only — no offer ids. |
| `create_intent_mandate` | Mint an AP2-shaped demo IntentMandate, returns `mandate_hash`. |
| `propose_money_action` | Propose a purchase. Requires `mandate_hash`, or you get HTTP 402. |

## Claude Desktop

Start the app first (`pnpm dev`), then add this to
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "countersign": {
      "command": "npx",
      "args": ["-y", "tsx", "C:/Users/Aryan/Desktop/countersign/packages/mcp/src/server.ts"],
      "env": {
        "COUNTERSIGN_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

On macOS or Linux use the POSIX path to `server.ts`.

## The flow an agent must follow

1. `create_intent_mandate` → `mandate_hash`
2. `search_catalog` / `lookup_skus` → real SKU ids
3. `propose_money_action` with those ids, a discount ask, and the hash

Skip step 1 and step 3 answers **HTTP 402** with
`{ "error": "mandate_required", "accept": ["ap2-intent-hash"], "continue_url": "/cart" }`.

Ask for 15% when policy allows 5% and the verdict is **CLAMP** with the 5%
offer id attached — not an error, and not 15%.
