/**
 * @countersign/contracts
 *
 * Shared Zod schemas and the types inferred from them. This is the single
 * source of truth for data crossing a boundary (HTTP, DB, Razorpay).
 *
 * The kernel deliberately does not import this package — it stays
 * dependency-free and declares its own structural types. The assertions at the
 * bottom of this file keep the two definitions from drifting apart.
 */
import { z } from "zod";

import type * as Kernel from "@countersign/kernel";

export const CONTRACTS_VERSION = "0.1.0" as const;

// ---------------------------------------------------------------- primitives

/** Every amount in this system is integer paise. Never floats, never rupees. */
export const PaiseSchema = z.number().int();

/** Basis points: 200 bps = 2%. Keeps discount maths in integers. */
export const BpsSchema = z.number().int();

export const CurrencySchema = z.literal("INR");
export type Currency = z.infer<typeof CurrencySchema>;

export const OfferIdSchema = z.string().regex(/^offer_[A-Za-z0-9]+$/, "not a Razorpay offer id");
export type OfferId = z.infer<typeof OfferIdSchema>;

// --------------------------------------------------------------- offer ladder

/**
 * One rung of the discount ladder: a discount we are allowed to grant, and the
 * dashboard offer that implements it.
 */
export const OfferRungSchema = z.object({
  discount_bps: BpsSchema.nonnegative(),
  offer_id: OfferIdSchema,
  /** Smallest cart this coupon may be used on, in paise. */
  min_cart_paise: PaiseSchema.nonnegative(),
  /** Most this coupon may ever take off, in paise, however big the cart. */
  max_discount_paise: PaiseSchema.positive(),
});
export type OfferRung = z.infer<typeof OfferRungSchema>;

/**
 * The coupon ladder.
 *
 * Seven coupons, each with the smallest cart it may be used on and the most it
 * may ever take off. The two bounds are what stop a big percentage from being
 * quoted on a small basket: 25% needs a 3,500-rupee cart before it is even a
 * candidate, and never gives away more than 1,500 rupees.
 *
 * `GET /offers` returns 400 on this account (see docs/SANDBOX_NOTES.md), so
 * there is no way to enumerate these at runtime — the ids are pasted in from
 * the dashboard by hand. Ordered ascending; the kernel relies on nothing but
 * the contents.

 *
 * These are the live dashboard ids. `attached_ok` on the audit row is what
 * confirms Razorpay actually applied one to an order — a 200 on order creation
 * does not.
 */
export const OFFER_LADDER: readonly OfferRung[] = [
  { discount_bps: 200, offer_id: "offer_TXZDq8aiNzKnQA", min_cart_paise: 10_000, max_discount_paise: 15_000 },
  { discount_bps: 500, offer_id: "offer_TXZFaRi7PFRQyz", min_cart_paise: 50_000, max_discount_paise: 40_000 },
  { discount_bps: 700, offer_id: "offer_TXZHijNccBb2uo", min_cart_paise: 80_000, max_discount_paise: 50_000 },
  { discount_bps: 1100, offer_id: "offer_TXZJgaeRd1v3mr", min_cart_paise: 120_000, max_discount_paise: 80_000 },
  { discount_bps: 1500, offer_id: "offer_TXZLlwmKPCba4H", min_cart_paise: 180_000, max_discount_paise: 100_000 },
  { discount_bps: 2000, offer_id: "offer_TXZNRbvkOLZbd1", min_cart_paise: 250_000, max_discount_paise: 120_000 },
  { discount_bps: 2500, offer_id: "offer_TXZP41NWz80tgL", min_cart_paise: 350_000, max_discount_paise: 150_000 },
] as const;

// ----------------------------------------------------------------- reasoning

/** Leaf values allowed inside a reason node's detail bag. */
export const ReasonValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ReasonValue = z.infer<typeof ReasonValueSchema>;

/**
 * A node in the explanation tree for a decision. The kernel returns one of
 * these per decision; it is what makes a verdict auditable rather than magic.
 */
export interface ReasonNode {
  /** Stable machine-readable slug, e.g. "amount_over_limit". */
  code: string;
  /** One human-readable sentence. */
  message: string;
  /** Structured facts behind this node. Always present, may be empty. */
  detail: Record<string, ReasonValue>;
  /** Sub-reasons. Always present, may be empty. */
  children: ReasonNode[];
}

export const ReasonNodeSchema: z.ZodType<ReasonNode> = z.lazy(() =>
  z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    detail: z.record(ReasonValueSchema),
    children: z.array(ReasonNodeSchema),
  }),
);

// ------------------------------------------------------------------- verdicts

export const KernelVerdictSchema = z.enum(["ALLOW", "CLAMP", "REJECT", "ESCALATE"]);
export type KernelVerdict = z.infer<typeof KernelVerdictSchema>;

// ------------------------------------------------------------------ proposals

/**
 * What an agent wants to do with money, before anyone has agreed to it.
 *
 * `margin_bps` is the margin available on this cart *before* discount; the
 * kernel subtracts the discount from it and checks the result against the
 * policy's margin floor. The caller computes it from the cart in our own DB —
 * Razorpay never sees line items.
 */
export const ProposedMoneyActionSchema = z.object({
  cart_id: z.string().min(1),
  amount_paise: PaiseSchema,
  currency: CurrencySchema,
  /** Discount the agent is asking for. */
  requested_discount_bps: BpsSchema,
  /** A specific offer the agent asked for, if any. Must be on the ladder. */
  requested_offer_id: OfferIdSchema.nullable(),
  product_ids: z.array(z.string().min(1)),
  margin_bps: BpsSchema,
});
export type ProposedMoneyAction = z.infer<typeof ProposedMoneyActionSchema>;

// -------------------------------------------------------------------- policy

export const PolicySchema = z.object({
  policy_version: z.string().min(1),
  max_order_paise: PaiseSchema.positive(),
  /** At or above this amount a human decides. `null` disables escalation. */
  escalate_above_paise: PaiseSchema.positive().nullable(),
  /** Post-discount margin must stay at or above this. */
  margin_floor_bps: BpsSchema,
  blocked_product_ids: z.array(z.string().min(1)),
  ladder: z.array(OfferRungSchema),
});
export type Policy = z.infer<typeof PolicySchema>;

// ------------------------------------------------------------------ decisions

/**
 * The kernel's answer. `offer_ids` is already in Razorpay's wire shape: a bare
 * array of id strings, to be sent with `force_offer: true`. The object form
 * `[{ offer_id }]` returns 200 and silently attaches nothing — see
 * docs/SANDBOX_NOTES.md.
 */
export const KernelDecisionSchema = z.object({
  verdict: KernelVerdictSchema,
  amount_paise: PaiseSchema,
  requested_discount_bps: BpsSchema,
  applied_discount_bps: BpsSchema,
  offer_ids: z.array(OfferIdSchema),
  force_offer: z.boolean(),
  policy_version: z.string().min(1),
  /** Inputs the kernel dropped instead of honoring, e.g. an off-ladder offer id. */
  ignored_inputs: z.array(z.string()),
  reasons: ReasonNodeSchema,
});
export type KernelDecision = z.infer<typeof KernelDecisionSchema>;

// --------------------------------------------------------------- razorpay wire

/**
 * The four keys we write into every Razorpay order's `notes`. Confirmed to
 * round-trip intact in recon. This is the audit pointer from money back to the
 * decision that authorized it.
 */
export const OrderNotesSchema = z.object({
  decision_id: z.string().min(1),
  mandate_hash: z.string().min(1),
  inputs_hash: z.string().min(1),
  policy_version: z.string().min(1),
});
export type OrderNotes = z.infer<typeof OrderNotesSchema>;

// ------------------------------------------------------- kernel drift guards

/**
 * Compile-time only. The kernel has zero dependencies and redeclares these
 * shapes locally; if either side changes, one of these lines stops compiling.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _verdictsMatch: Exact<KernelVerdict, Kernel.KernelVerdict> = true;
const _rungsMatch: Exact<OfferRung, Kernel.OfferRung> = true;
const _reasonsMatch: Exact<ReasonNode, Kernel.ReasonNode> = true;
const _proposalsMatch: Exact<ProposedMoneyAction, Kernel.ProposedMoneyAction> = true;
const _policiesMatch: Exact<Policy, Kernel.Policy> = true;
const _decisionsMatch: Exact<KernelDecision, Kernel.KernelDecision> = true;

void _verdictsMatch;
void _rungsMatch;
void _reasonsMatch;
void _proposalsMatch;
void _policiesMatch;
void _decisionsMatch;

export { z };
