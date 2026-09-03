import { mintAndRegisterDemoIntent } from "@/server/mandates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/mandates/demo — mint a demo IntentMandate for the dev UI.
 *
 * Exists so a human can pay without hand-crafting a mandate. It is not an
 * authorisation endpoint: a real deployment issues intents from whatever
 * actually authenticates the shopper.
 */
export function POST(): Response {
  const { hash, intent } = mintAndRegisterDemoIntent();
  return Response.json({ mandate_hash: hash, intent });
}
