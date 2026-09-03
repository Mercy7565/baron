/**
 * @countersign/kernel
 *
 * The decision core. Pure, dependency-free, deterministic.
 *
 * Hard rules for everything in this package:
 *   - no imports, of any kind
 *   - no I/O, no fetch, no filesystem
 *   - no Date.now(), no Math.random(), no ambient state
 *   - same inputs always produce the same decision, forever
 *
 * Anything ambient (ids, timestamps, hashes) is computed by callers and passed
 * in. That is what makes a decision replayable months later during a dispute.
 */

export const KERNEL_VERSION = "0.1.0" as const;

// ----------------------------------------------------------------- the shapes

/**
 * These are redeclared here rather than imported so the kernel keeps zero
 * dependencies. @countersign/contracts holds the Zod versions and asserts at
 * compile time that the two stay identical.
 */

export type Currency = "INR";

export type KernelVerdict = "ALLOW" | "CLAMP" | "REJECT" | "ESCALATE";

export interface OfferRung {
  discount_bps: number;
  offer_id: string;
  /** Smallest cart this coupon may be used on, in paise. */
  min_cart_paise: number;
  /** Most this coupon may ever take off, in paise. */
  max_discount_paise: number;
}

export type ReasonValue = string | number | boolean | null;

export interface ReasonNode {
  code: string;
  message: string;
  detail: Record<string, ReasonValue>;
  children: ReasonNode[];
}

export interface ProposedMoneyAction {
  cart_id: string;
  amount_paise: number;
  currency: Currency;
  requested_discount_bps: number;
  requested_offer_id: string | null;
  product_ids: string[];
  margin_bps: number;
}

export interface Policy {
  policy_version: string;
  max_order_paise: number;
  escalate_above_paise: number | null;
  margin_floor_bps: number;
  blocked_product_ids: string[];
  ladder: OfferRung[];
}

export interface KernelDecision {
  verdict: KernelVerdict;
  amount_paise: number;
  requested_discount_bps: number;
  applied_discount_bps: number;
  offer_ids: string[];
  force_offer: boolean;
  policy_version: string;
  /**
   * Inputs the kernel refused to act on — an off-ladder offer id, for example.
   * Dropped, never honored, and reported so the caller can see exactly what an
   * agent tried to smuggle in.
   */
  ignored_inputs: string[];
  reasons: ReasonNode;
}

// --------------------------------------------------------------- reason nodes

function reason(
  code: string,
  message: string,
  detail: Record<string, ReasonValue> = {},
  children: ReasonNode[] = [],
): ReasonNode {
  return { code, message, detail, children };
}

// ------------------------------------------------------------------ internals

/**
 * The highest rung that is at or below `requestedBps`, whose minimum cart this
 * basket actually meets, and which still leaves margin at or above the floor.
 * `null` when nothing on the ladder qualifies.
 *
 * Three independent gates, all of which have to pass:
 *
 *   - the ask       a coupon bigger than what was requested is not on offer
 *   - the min cart  a 25% coupon needs a 3,500-rupee basket to exist at all,
 *                   so it can never be quoted on a 749-rupee one
 *   - the floor     margin after the discount must stay at or above the floor,
 *                   which is why the top rungs usually lose on a real cart
 *
 * The floor is checked against the coupon's nominal percentage rather than its
 * capped rupee value. That is deliberate and conservative: a cap only ever
 * reduces what is given away, so judging by the nominal rate can refuse a
 * coupon that would have squeaked past, and can never let one through that
 * should have been refused.
 *
 * Iterates in ladder order and keeps the best match, so the result does not
 * depend on the ladder being pre-sorted.
 */
function bestEligibleRung(
  ladder: OfferRung[],
  requestedBps: number,
  amountPaise: number,
  marginBps: number,
  marginFloorBps: number,
): OfferRung | null {
  let best: OfferRung | null = null;
  for (const rung of ladder) {
    if (rung.discount_bps > requestedBps) continue;
    if (amountPaise < rung.min_cart_paise) continue;
    if (marginBps - rung.discount_bps < marginFloorBps) continue;
    if (best === null || rung.discount_bps > best.discount_bps) best = rung;
  }
  return best;
}

/**
 * What a coupon actually takes off this cart: its percentage, never more than
 * its rupee cap. Pure arithmetic on integers, so the money layer and the kernel
 * cannot disagree about the number.
 */
export function couponDiscountPaise(rung: OfferRung, amountPaise: number): number {
  const raw = Math.floor((amountPaise * rung.discount_bps) / 10_000);
  return raw < rung.max_discount_paise ? raw : rung.max_discount_paise;
}

/**
 * The lowest minimum-cart on any rung the request could otherwise have reached.
 * Reported when nothing fits, so a caller can tell a shopper how far off they
 * are instead of just saying no.
 */
function smallestMinCart(ladder: OfferRung[], requestedBps: number): number | null {
  let smallest: number | null = null;
  for (const rung of ladder) {
    if (rung.discount_bps > requestedBps) continue;
    if (smallest === null || rung.min_cart_paise < smallest) smallest = rung.min_cart_paise;
  }
  return smallest;
}

function findRungById(ladder: OfferRung[], offerId: string): OfferRung | null {
  for (const rung of ladder) {
    if (rung.offer_id === offerId) return rung;
  }
  return null;
}

function blockedProducts(productIds: string[], blocked: string[]): string[] {
  const hits: string[] = [];
  for (const id of productIds) {
    if (blocked.includes(id) && !hits.includes(id)) hits.push(id);
  }
  return hits;
}

function reject(
  proposal: ProposedMoneyAction,
  policy: Policy,
  reasons: ReasonNode,
  ignored: string[] = [],
): KernelDecision {
  return {
    verdict: "REJECT",
    amount_paise: proposal.amount_paise,
    requested_discount_bps: proposal.requested_discount_bps,
    applied_discount_bps: 0,
    offer_ids: [],
    force_offer: false,
    policy_version: policy.policy_version,
    ignored_inputs: ignored,
    reasons,
  };
}

// -------------------------------------------------------------------- the core

/**
 * Decide what may happen to money.
 *
 * Order of checks matters and is deliberate: hard stops (currency, amount,
 * blocked products) run before any discount reasoning, so a rejected proposal
 * never gets an offer id attached to it. An off-ladder offer id is not a hard
 * stop — it is dropped into ignored_inputs and the request continues.
 *
 * The returned `offer_ids` are only ever ids taken from `policy.ladder`. The
 * kernel has no other source of offer ids and cannot invent one.
 */
export function evaluate(proposal: ProposedMoneyAction, policy: Policy): KernelDecision {
  // --- hard stops ---------------------------------------------------------

  if (proposal.currency !== "INR") {
    return reject(
      proposal,
      policy,
      reason("currency_unsupported", "Only INR is supported.", {
        currency: proposal.currency,
      }),
    );
  }

  if (!Number.isInteger(proposal.amount_paise)) {
    return reject(
      proposal,
      policy,
      reason("amount_not_integer", "Amount must be integer paise.", {
        amount_paise: proposal.amount_paise,
      }),
    );
  }

  if (proposal.amount_paise <= 0) {
    return reject(
      proposal,
      policy,
      reason("amount_not_positive", "Amount must be greater than zero.", {
        amount_paise: proposal.amount_paise,
      }),
    );
  }

  if (proposal.amount_paise > policy.max_order_paise) {
    return reject(
      proposal,
      policy,
      reason("amount_over_limit", "Amount exceeds the maximum order size.", {
        amount_paise: proposal.amount_paise,
        max_order_paise: policy.max_order_paise,
      }),
    );
  }

  const blocked = blockedProducts(proposal.product_ids, policy.blocked_product_ids);
  if (blocked.length > 0) {
    return reject(
      proposal,
      policy,
      reason("product_blocked", "Cart contains a blocked product.", {
        blocked_product_ids: blocked.join(","),
      }),
    );
  }

  // An offer id that is not on the ladder is an injected or corrupted input.
  // It is neither honored nor fatal: it is dropped, recorded, and the request
  // continues on its bps alone. The agent can ask for anything; only ladder
  // offers can ever be applied.
  const ignoredInputs: string[] = [];
  let requestedRung: OfferRung | null = null;
  if (proposal.requested_offer_id !== null) {
    requestedRung = findRungById(policy.ladder, proposal.requested_offer_id);
    if (requestedRung === null) {
      ignoredInputs.push(`requested_offer_id=${proposal.requested_offer_id} (not on ladder)`);
    }
  }

  // --- what is actually being asked for -----------------------------------

  // A named offer is authoritative over the loose bps figure: it is the more
  // specific request, and it is what the agent would have sent to Razorpay.
  const requestedBps =
    requestedRung !== null ? requestedRung.discount_bps : proposal.requested_discount_bps;

  const requestSource = reason(
    "request_read",
    requestedRung !== null
      ? "Requested discount taken from the named offer."
      : "Requested discount taken from requested_discount_bps.",
    {
      requested_discount_bps: requestedBps,
      requested_offer_id: proposal.requested_offer_id,
    },
  );

  if (requestedBps < 0) {
    return reject(
      proposal,
      policy,
      reason("discount_negative", "Requested discount cannot be negative.", {
        requested_discount_bps: requestedBps,
      }),
      ignoredInputs,
    );
  }

  const chosen = bestEligibleRung(
    policy.ladder,
    requestedBps,
    proposal.amount_paise,
    proposal.margin_bps,
    policy.margin_floor_bps,
  );

  // --- escalation ---------------------------------------------------------

  // Large orders go to a human. Nothing is auto-applied on the way out: the
  // candidate rung is reported in the reasons, not in offer_ids.
  if (policy.escalate_above_paise !== null && proposal.amount_paise >= policy.escalate_above_paise) {
    return {
      verdict: "ESCALATE",
      amount_paise: proposal.amount_paise,
      requested_discount_bps: requestedBps,
      applied_discount_bps: 0,
      offer_ids: [],
      force_offer: false,
      policy_version: policy.policy_version,
      ignored_inputs: ignoredInputs,
      reasons: reason(
        "escalate_amount",
        "Amount is at or above the escalation threshold; a human must decide.",
        {
          amount_paise: proposal.amount_paise,
          escalate_above_paise: policy.escalate_above_paise,
          candidate_offer_id: chosen === null ? null : chosen.offer_id,
          candidate_discount_bps: chosen === null ? 0 : chosen.discount_bps,
        },
        [requestSource],
      ),
    };
  }

  // --- discount resolution ------------------------------------------------

  if (chosen === null) {
    // Nothing on the ladder fits. If no discount was wanted, that is a plain
    // allow; otherwise the request is clamped all the way down to zero.
    const noDiscount = requestedBps === 0;
    return {
      verdict: noDiscount ? "ALLOW" : "CLAMP",
      amount_paise: proposal.amount_paise,
      requested_discount_bps: requestedBps,
      applied_discount_bps: 0,
      offer_ids: [],
      force_offer: false,
      policy_version: policy.policy_version,
      ignored_inputs: ignoredInputs,
      reasons: reason(
        noDiscount ? "allow_no_discount" : "clamp_to_zero",
        noDiscount
          ? "No discount requested; order allowed at full price."
          : "No coupon fits: every rung is either above the request, above this cart's size, or below the margin floor.",
        {
          requested_discount_bps: requestedBps,
          amount_paise: proposal.amount_paise,
          margin_bps: proposal.margin_bps,
          margin_floor_bps: policy.margin_floor_bps,
          // The smallest cart that would have unlocked anything at all, so the
          // caller can say "spend this much more" without guessing.
          smallest_min_cart_paise: smallestMinCart(policy.ladder, requestedBps),
        },
        [requestSource],
      ),
    };
  }

  const exact = chosen.discount_bps === requestedBps;

  return {
    verdict: exact ? "ALLOW" : "CLAMP",
    amount_paise: proposal.amount_paise,
    requested_discount_bps: requestedBps,
    applied_discount_bps: chosen.discount_bps,
    offer_ids: [chosen.offer_id],
    force_offer: true,
    policy_version: policy.policy_version,
    ignored_inputs: ignoredInputs,
    reasons: reason(
      exact ? "allow_exact_rung" : "clamp_to_rung",
      exact
        ? "Requested discount matches an allowed rung."
        : "Requested discount clamped down to the nearest allowed rung.",
      {
        requested_discount_bps: requestedBps,
        applied_discount_bps: chosen.discount_bps,
        offer_id: chosen.offer_id,
        min_cart_paise: chosen.min_cart_paise,
        max_discount_paise: chosen.max_discount_paise,
        discount_paise: couponDiscountPaise(chosen, proposal.amount_paise),
        margin_bps: proposal.margin_bps,
        margin_floor_bps: policy.margin_floor_bps,
      },
      [requestSource],
    ),
  };
}
