/**
 * Package-private secrets.
 *
 * Deliberately NOT re-exported from index.ts: anything importing
 * `@countersign/vault` gets the public surface only, so a grep of the app, the
 * kernel, the audit log or any API response finds nothing.
 *
 * There is exactly one value here now. The sandbox step-up code used to live
 * beside it, for a headless payer that always got blocked by Razorpay's hosted
 * page. That payer is gone and so is the code — the buyer completes the
 * Payment Link themselves, so nothing in this repo needs an OTP.
 */

/** Razorpay's Indian test card. Displayed for a human to type; never sent. */
export const SANDBOX_TEST_PAN = "5267318187975449";
