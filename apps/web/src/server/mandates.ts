import {
  type IntentMandate,
  type MandateBundle,
  mandateHash,
  mintDemoIntent,
} from "@countersign/mandates";

/**
 * Mandate registry.
 *
 * A caller presents a mandate_hash; we look up the bundle it stands for. Held
 * on globalThis so Next's dev module reloads do not lose it mid-demo.
 */
const globalForMandates = globalThis as typeof globalThis & {
  __countersign_mandates?: Map<string, MandateBundle>;
};

const STORE: Map<string, MandateBundle> =
  globalForMandates.__countersign_mandates ?? new Map<string, MandateBundle>();

globalForMandates.__countersign_mandates = STORE;

export function registerIntent(intent: IntentMandate): { hash: string; intent: IntentMandate } {
  const bundle: MandateBundle = { intent, cart: null, payment: null };
  const hash = mandateHash(bundle);
  STORE.set(hash, bundle);
  return { hash, intent };
}

export function lookupMandate(hash: string | null | undefined): MandateBundle | null {
  if (hash === null || hash === undefined || hash === "") return null;
  return STORE.get(hash) ?? null;
}

/** Mint a fresh demo intent for the dev UI. */
export function mintAndRegisterDemoIntent(): { hash: string; intent: IntentMandate } {
  return registerIntent(mintDemoIntent(new Date()));
}

/**
 * The 402 body. Shared by every entry point so an outside agent gets the same
 * answer from ACP and from the propose route.
 */
export function mandateRequiredResponse(continueUrl = "/cart"): Response {
  return Response.json(
    {
      error: "mandate_required",
      accept: ["ap2-intent-hash"],
      continue_url: continueUrl,
    },
    {
      status: 402,
      headers: {
        // x402-shaped: a header an agent can branch on without parsing the body.
        // There is no crypto rail behind this and no facilitator.
        "payment-required": 'ap2-intent-hash realm="countersign"',
        "cache-control": "no-store",
      },
    },
  );
}
