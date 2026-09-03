import { ProposedMoneyActionSchema } from "@countersign/contracts";
import { guardCart } from "@countersign/guard";
import { evaluate } from "@countersign/kernel";
import { appendAuditRecord, buildOrderNotes } from "@countersign/ledger";
import {
  type CartMandate,
  type PaymentMandate,
  checkAgainstIntent,
  mandateHash,
} from "@countersign/mandates";
import { createOrder, offersAttached } from "@countersign/razorpay";

import { CATALOG } from "@/lib/catalog";
import { DEV_POLICY } from "@/lib/policy";
import { lookupMandate } from "@/server/mandates";

/** Fields the direct proposal schema knows about. Anything else is dropped. */
const KNOWN_FIELDS = new Set([...Object.keys(ProposedMoneyActionSchema.shape), "mandate_hash"]);

/** Cart-shaped requests carry these instead; they are known, not smuggled. */
const CART_FIELDS = new Set([
  "cart_id",
  "lines",
  "currency",
  "requested_discount_bps",
  "requested_offer_id",
  "quoted_amount_paise",
  "free_text",
  "claimed_attributes",
  "campaign_id",
  "mandate_hash",
]);

function droppedFields(body: unknown, known: Set<string>): string[] {
  if (typeof body !== "object" || body === null) return [];
  return Object.keys(body)
    .filter((k) => !known.has(k))
    .map((k) => `${k} (unknown field, dropped before evaluation)`);
}

interface CartRequest {
  cart_id: string;
  lines: Array<{ sku_id: string; qty: number }>;
  currency: string;
  requested_discount_bps: number;
  requested_offer_id: string | null;
  quoted_amount_paise: number | null;
  free_text: string | null;
  claimed_attributes: Record<string, Record<string, string>>;
  campaign_id: string | null;
  mandate_hash?: string | null;
}

function isCartRequest(body: unknown): body is CartRequest {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { lines?: unknown }).lines)
  );
}

/**
 * POST /api/checkout/propose
 *
 * The single money path. Two request shapes reach it:
 *
 *   - cart-shaped   { cart_id, lines, ... }  — used by the in-app agent, ACP
 *                     and MCP. Runs guardCart first, so a hallucinated SKU,
 *                     an out-of-stock line, a blocked SKU, a quantity overflow
 *                     or a drifting price is resolved against the catalog
 *                     before the kernel ever sees an amount.
 *   - direct        a raw ProposedMoneyAction — used by /lab and the scripts.
 *
 * Both converge on one evaluate() and one createOrder call site. A REJECT
 * always answers razorpay_calls_this_request: 0.
 */
export interface ProposeResult {
  status: number;
  json: Record<string, unknown>;
}

/**
 * The single money path, as a plain function.
 *
 * This used to live only behind the HTTP route, and `issueLinkForQuote` reached
 * it with a loopback `fetch` to our own origin. That worked in dev — one Node
 * process, one `globalThis`, one mandate registry — and broke the moment the
 * two routes landed in different serverless instances: the mandate minted by
 * `/api/mandates/demo` was simply absent from the `/api/checkout/propose`
 * instance, which answered 402 `mandate_required`. That body carries no
 * `verdict` key, so the caller reported "propose produced no order (verdict
 * unknown)" — a real bug wearing a useless message.
 *
 * Calling it in-process removes the loopback entirely: no second registry, no
 * dependence on APP_BASE_URL being right, and one `createOrder` call site
 * still, because the route below is now a thin wrapper over this.
 */
export async function proposeOrder(body: unknown): Promise<ProposeResult> {
  // Narrow once into a local so every later read is typed.
  const cartBody: CartRequest | null = isCartRequest(body) ? body : null;
  const dropped = droppedFields(body, cartBody !== null ? CART_FIELDS : KNOWN_FIELDS);

  // ---------------------------------------------------------------------- 402
  //
  // x402-shaped: no valid mandate, no money path. This is a status code and a
  // body, not a settlement rail — no chain, no facilitator, no signature to
  // verify. The header lets an agent branch without parsing the body.
  const presentedHash =
    cartBody !== null
      ? (cartBody.mandate_hash ?? null)
      : ((body as { mandate_hash?: string | null } | null)?.mandate_hash ?? null);

  const bundle = lookupMandate(presentedHash);
  if (bundle === null) {
    // Same body the route serves, but shaped so an in-process caller can read
    // the reason instead of guessing at a missing `verdict` key.
    return {
      status: 402,
      json: { error: "mandate_required", accept: ["ap2-intent-hash"], continue_url: "/cart" },
    };
  }

  // ---------------------------------------------------------------- normalise

  let proposalInput: unknown;
  let guardFindings: ReturnType<typeof guardCart>["findings"] = [];
  let guardIgnored: string[] = [];
  let campaignId: string | null = null;
  let cartLines: Array<{ sku_id: string; qty: number; title: string; line_total_paise: number }> =
    [];

  if (cartBody !== null) {
    campaignId = cartBody.campaign_id ?? null;

    const guarded = guardCart({
      catalog: CATALOG,
      lines: cartBody.lines,
      currency: cartBody.currency,
      claimed_attributes: cartBody.claimed_attributes ?? {},
      quoted_amount_paise: cartBody.quoted_amount_paise ?? null,
      free_text: cartBody.free_text ?? null,
      blocked_product_ids: DEV_POLICY.blocked_product_ids,
    });

    guardFindings = guarded.findings;
    guardIgnored = guarded.ignored_inputs;

    // The guard refused. Razorpay is never called, and the refusal is audited
    // with the mistake codes that caused it.
    if (!guarded.ok || guarded.cart === null) {
      const codes = guarded.findings
        .filter((f) => f.disposition === "REJECT")
        .map((f) => f.code);

      appendAuditRecord({
        kind: "decision",
        decision_id: null,
        order_id: null,
        payment_id: null,
        event_id: null,
        verdict: "REJECT",
        offer_id: null,
        attached_ok: null,
        webhook_status: null,
      });

      return { status: 200, json: {
          verdict: {
            verdict: "REJECT",
            amount_paise: 0,
            requested_discount_bps: cartBody.requested_discount_bps,
            applied_discount_bps: 0,
            offer_ids: [],
            force_offer: false,
            policy_version: DEV_POLICY.policy_version,
            ignored_inputs: [...guarded.ignored_inputs, ...dropped],
            reasons: {
              code: "guard_refused",
              message: "The cart did not survive validation against the catalog.",
              detail: { mistake_codes: codes.join(",") },
              children: [],
            },
          },
          order: null,
          mistakes: guarded.findings,
          ignored_inputs: [...guarded.ignored_inputs, ...dropped],
          razorpay_calls_this_request: 0,
        } };
    }

    cartLines = guarded.cart.lines.map((l) => ({
      sku_id: l.sku_id,
      qty: l.qty,
      title: l.title,
      line_total_paise: l.line_total_paise,
    }));

    // Amount and margin come from the catalog, never from the request.
    proposalInput = {
      cart_id: cartBody.cart_id,
      amount_paise: guarded.cart.amount_paise,
      currency: "INR",
      requested_discount_bps: cartBody.requested_discount_bps,
      requested_offer_id: cartBody.requested_offer_id ?? null,
      product_ids: guarded.cart.product_ids,
      margin_bps: guarded.cart.margin_bps,
    };
  } else {
    proposalInput = body;
  }

  const parsed = ProposedMoneyActionSchema.safeParse(proposalInput);
  if (!parsed.success) {
    return { status: 400, json: {
        error: "invalid ProposedMoneyAction",
        issues: parsed.error.issues,
        razorpay_calls_this_request: 0,
      } };
  }
  const parsedProposal = parsed.data;

  // -------------------------------------------------------------- the mandate
  //
  // Enforced here, outside the kernel: over-amount is a refusal because the
  // human never agreed to that number, while over-discount is only a clamp
  // because they agreed to *at most* that much off. The kernel then clamps
  // again against the ladder and the margin floor.
  const intentCheck = checkAgainstIntent(
    bundle.intent,
    parsedProposal.amount_paise,
    parsedProposal.requested_discount_bps,
    parsedProposal.product_ids,
    new Date(),
  );

  const mandateIgnored: string[] = [];

  if (!intentCheck.valid) {
    appendAuditRecord({
      kind: "decision",
      decision_id: null,
      order_id: null,
      payment_id: null,
      event_id: null,
      verdict: "REJECT",
      offer_id: null,
      attached_ok: null,
      webhook_status: null,
    });

    return { status: 200, json: {
        verdict: {
          verdict: "REJECT",
          amount_paise: parsedProposal.amount_paise,
          requested_discount_bps: parsedProposal.requested_discount_bps,
          applied_discount_bps: 0,
          offer_ids: [],
          force_offer: false,
          policy_version: DEV_POLICY.policy_version,
          ignored_inputs: [...guardIgnored, ...dropped],
          reasons: {
            code: `mandate_${intentCheck.problem ?? "invalid"}`,
            message: intentCheck.message,
            detail: { max_amount_paise: bundle.intent.max_amount_paise },
            children: [],
          },
        },
        order: null,
        mistakes: guardFindings,
        ignored_inputs: [...guardIgnored, ...dropped],
        razorpay_calls_this_request: 0,
      } };
  }

  if (intentCheck.discount_clamped) {
    mandateIgnored.push(
      `requested_discount_bps=${parsedProposal.requested_discount_bps} (above mandate ceiling ${bundle.intent.max_discount_bps}, reduced)`,
    );
  }

  // The kernel sees only what the mandate authorises.
  const proposal = {
    ...parsedProposal,
    requested_discount_bps: intentCheck.allowed_discount_bps,
  };

  // ------------------------------------------------------------------ decide

  const verdict = evaluate(proposal, DEV_POLICY);

  const ignored_inputs = [
    ...verdict.ignored_inputs,
    ...mandateIgnored,
    ...guardIgnored,
    ...dropped,
  ];

  // The campaign id is part of what shaped this request, so it is inside
  // inputs_hash — a campaign-driven decision cannot be replayed as a plain one.
  // The cart stage of the mandate chain: this cart, committed to this intent.
  const cartMandate: CartMandate = {
    items: cartLines.map((l) => ({ sku_id: l.sku_id, qty: l.qty })),
    amount_paise: proposal.amount_paise,
    intent_hash: mandateHash({ intent: bundle.intent, cart: null, payment: null }),
  };

  const chainedMandateHash = mandateHash({
    intent: bundle.intent,
    cart: cartMandate,
    payment: null,
  });

  const notes = {
    ...buildOrderNotes(
      proposal,
      DEV_POLICY,
      verdict,
      campaignId === null ? {} : { campaign_id: campaignId },
    ),
    // notes.mandate_hash pins intent+cart, so a hash minted for one cart cannot
    // be replayed against another.
    mandate_hash: chainedMandateHash,
  };

  if (verdict.verdict === "REJECT" || verdict.verdict === "ESCALATE") {
    appendAuditRecord({
      kind: "decision",
      decision_id: notes.decision_id,
      order_id: null,
      payment_id: null,
      event_id: null,
      verdict: verdict.verdict,
      offer_id: null,
      attached_ok: null,
      webhook_status: null,
    });

    return { status: 200, json: {
        verdict,
        order: null,
        cart_lines: cartLines,
        mistakes: guardFindings,
        campaign_id: campaignId,
        ignored_inputs,
        razorpay_calls_this_request: 0,
      } };
  }

  // --------------------------------------------------------------------- act

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return { status: 500, json: {
        verdict,
        order: null,
        ignored_inputs,
        error: "Razorpay credentials are not configured",
        razorpay_calls_this_request: 0,
      } };
  }

  const result = await createOrder(
    { keyId, keySecret },
    {
      amount_paise: verdict.amount_paise,
      currency: "INR",
      receipt: notes.decision_id,
      notes,
      // Bare id strings; createOrder adds force_offer: true when non-empty.
      offer_ids: verdict.offer_ids,
    },
  );

  if (!result.ok) {
    return { status: 502, json: {
        verdict,
        order: null,
        ignored_inputs,
        error: result.error,
        razorpay_status: result.status,
        razorpay_calls_this_request: 1,
      } };
  }

  const order = result.data;

  // The payment stage: this order, committed to that cart. Reported so a caller
  // can verify the full chain; the order already carries intent+cart in notes.
  const paymentMandate: PaymentMandate = {
    order_id: order.id,
    amount_paise: verdict.amount_paise,
    cart_hash: mandateHash({ intent: bundle.intent, cart: cartMandate, payment: null }),
  };
  const fullMandateHash = mandateHash({
    intent: bundle.intent,
    cart: cartMandate,
    payment: paymentMandate,
  });

  // A 200 from Razorpay does not mean the offer applied.
  const expectedOffer = verdict.offer_ids.length > 0;
  const offer_applied = expectedOffer ? offersAttached(order) : true;

  appendAuditRecord({
    kind: "decision",
    decision_id: notes.decision_id,
    order_id: order.id,
    payment_id: null,
    event_id: null,
    verdict: verdict.verdict,
    offer_id: verdict.offer_ids[0] ?? null,
    attached_ok: offer_applied,
    webhook_status: null,
  });

  return { status: 200, json: {
      verdict,
      order,
      cart_lines: cartLines,
      mistakes: guardFindings,
      campaign_id: campaignId,
      mandate: { hash: notes.mandate_hash, full_chain_hash: fullMandateHash },
      ignored_inputs,
      razorpay_calls_this_request: 1,
      ...(offer_applied ? {} : { warning: "offer requested but not attached by Razorpay" }),
    } };
}
