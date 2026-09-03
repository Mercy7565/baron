import { SETTLEMENT_MODE } from "@countersign/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health
 *
 * Liveness plus the one fact an integrator most needs before wiring anything:
 * how money actually settles here. `razorpay_payment_link` means the buyer
 * completes a link — there is no server-to-server capture on this account, and
 * nothing in this build pretends otherwise.
 */
export function GET(): Response {
  return Response.json(
    {
      ok: true,
      settlement: SETTLEMENT_MODE,
      service: "baron",
      mode: "razorpay_test",
    },
    { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } },
  );
}
