/**
 * Clamp demo — the one case that proves the kernel is actually in the path.
 *
 * The proposal asks for 15%. The cart carries 53% margin against a 48% floor,
 * so only 500 bps of headroom exists and at most 5% may be given away. The expected answer is a
 * CLAMP down to the 5% rung, offer_TVGCPhnzBPaP1Q — never the 15% offer.
 *
 * Needs the app running: pnpm dev
 * Run with: pnpm demo:clamp
 */

const BASE_URL = process.env.CS_BASE_URL ?? "http://localhost:3000";
const ENDPOINT = `${BASE_URL}/api/checkout/propose`;

const EXPECTED_VERDICT = "CLAMP";
const EXPECTED_OFFER_ID = "offer_TVGCPhnzBPaP1Q";

const proposal = {
  cart_id: "cart_clamp_demo",
  amount_paise: 50_000,
  currency: "INR",
  // Asking for 15% …
  requested_discount_bps: 1500,
  requested_offer_id: null,
  product_ids: ["sku_ok"],
  // … on a cart with 53% margin against a 48% floor: 500 bps of headroom.
  margin_bps: 5300,
};

async function main(): Promise<void> {
  // Every money path needs a mandate now; mint one the way the dev UI does.
  const mintRes = await fetch(`${BASE_URL}/api/mandates/demo`, { method: "POST" });
  const { mandate_hash } = (await mintRes.json()) as { mandate_hash: string };
  console.log(`minted mandate ${mandate_hash.slice(0, 16)}…`);

  console.log(`POST ${ENDPOINT}`);
  console.log(`asking for ${proposal.requested_discount_bps / 100}% on ${proposal.cart_id}\n`);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...proposal, mandate_hash }),
    });
  } catch (err) {
    console.error(`could not reach ${ENDPOINT} — is the app running? (pnpm dev)`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const raw = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    payload = raw;
  }

  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(payload, null, 2));

  const verdict = (payload as { verdict?: { verdict?: string; offer_ids?: string[] } }).verdict;
  const gotVerdict = verdict?.verdict;
  const gotOffers = verdict?.offer_ids ?? [];

  const verdictOk = gotVerdict === EXPECTED_VERDICT;
  const offerOk = gotOffers.length === 1 && gotOffers[0] === EXPECTED_OFFER_ID;

  console.log("");
  console.log(`verdict   expected ${EXPECTED_VERDICT} · got ${gotVerdict ?? "(none)"}`);
  console.log(
    `offer_ids expected [${EXPECTED_OFFER_ID}] · got [${gotOffers.join(", ")}]`,
  );

  if (verdictOk && offerOk) {
    console.log("\nclamp demo PASSED");
  } else {
    console.log("\nclamp demo FAILED");
    process.exitCode = 1;
  }
}

void main();
