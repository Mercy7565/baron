/**
 * @countersign/guard
 *
 * The AI mistake catalog.
 *
 * An agent can be wrong in a bounded number of ways. Each one is a typed code
 * with a fixed disposition, so "the model got fooled" never becomes "the money
 * moved wrong". The guard runs *before* the kernel: it normalises a proposal
 * against the catalog and reports what it had to correct or refuse.
 *
 * Division of labour, deliberately strict:
 *   - guard  decides what the cart really is (sku, qty, price, stock, currency)
 *   - kernel decides what discount may apply, and owns every offer id
 * The guard never picks an offer id and never calls a payment provider.
 */
import {
  type Catalog,
  type CartLine,
  type PricedCart,
  priceCart,
  productById,
} from "@countersign/catalog";

export const GUARD_VERSION = "0.1.0" as const;

/** Every way an agent is allowed to be wrong. */
export enum MistakeCode {
  SkuHallucinated = "sku_hallucinated",
  VariantMismatch = "variant_mismatch",
  QtyOverflow = "qty_overflow",
  Oos = "oos",
  PriceDrift = "price_drift",
  CurrencyInvalid = "currency_invalid",
  PromoHallucinated = "promo_hallucinated",
  OverDiscount = "over_discount",
  MarginBreach = "margin_breach",
  AmountOverCap = "amount_over_cap",
  BlockedSku = "blocked_sku",
  MandateMissingOrExpired = "mandate_missing_or_expired",
  PromptInjection = "prompt_injection",
  CampaignStacking = "campaign_stacking",
  StaleCampaign = "stale_campaign",
}

/** What the plane does about it. ALLOW means "continue, but on the record". */
export type Disposition = "ALLOW" | "CLAMP" | "REJECT";

export interface MistakeSpec {
  code: MistakeCode;
  disposition: Disposition;
  /** One sentence, written for a judge reading /failures. */
  summary: string;
  /** Which layer catches it. */
  caught_by: "guard" | "kernel" | "route";
}

/**
 * The whole contract in one table. /failures renders this directly, so the docs
 * cannot drift from the behaviour.
 */
export const MISTAKE_CATALOG: readonly MistakeSpec[] = [
  {
    code: MistakeCode.SkuHallucinated,
    disposition: "REJECT",
    summary: "The agent named a SKU that is not in the catalog. Nothing is priced or ordered.",
    caught_by: "guard",
  },
  {
    code: MistakeCode.VariantMismatch,
    disposition: "REJECT",
    summary:
      "The agent asked for attributes (size, shade) that do not match the SKU it put in the cart.",
    caught_by: "guard",
  },
  {
    code: MistakeCode.QtyOverflow,
    disposition: "CLAMP",
    summary: "Quantity exceeds max_qty or available stock. Clamped down to what is sellable.",
    caught_by: "guard",
  },
  {
    code: MistakeCode.Oos,
    disposition: "REJECT",
    summary: "The SKU is not in stock. An out-of-stock line cannot become an order.",
    caught_by: "guard",
  },
  {
    code: MistakeCode.PriceDrift,
    disposition: "CLAMP",
    summary:
      "The price the agent quoted differs from the catalog. The catalog price is used; the spoken number is discarded.",
    caught_by: "guard",
  },
  {
    code: MistakeCode.CurrencyInvalid,
    disposition: "REJECT",
    summary: "Anything other than INR is refused outright.",
    caught_by: "guard",
  },
  {
    code: MistakeCode.PromoHallucinated,
    disposition: "CLAMP",
    summary:
      "An invented promo code or off-ladder offer id. Dropped into ignored_inputs; the kernel still picks a legal rung.",
    caught_by: "kernel",
  },
  {
    code: MistakeCode.OverDiscount,
    disposition: "CLAMP",
    summary: "More discount was requested than any legal rung allows. Clamped to the highest legal rung.",
    caught_by: "kernel",
  },
  {
    code: MistakeCode.MarginBreach,
    disposition: "CLAMP",
    summary:
      "The requested rung would push margin below the floor. Clamped down, or to no discount at all.",
    caught_by: "kernel",
  },
  {
    code: MistakeCode.AmountOverCap,
    disposition: "REJECT",
    summary: "Cart exceeds max_order_paise. Refused with razorpay_calls_this_request = 0.",
    caught_by: "kernel",
  },
  {
    code: MistakeCode.BlockedSku,
    disposition: "REJECT",
    summary: "The SKU is on the policy denylist and cannot be sold through the agent channel.",
    caught_by: "guard",
  },
  {
    code: MistakeCode.MandateMissingOrExpired,
    disposition: "REJECT",
    summary: "No valid mandate on the request. Answered with HTTP 402; no order is created.",
    caught_by: "route",
  },
  {
    code: MistakeCode.PromptInjection,
    disposition: "ALLOW",
    summary:
      "Instructions smuggled into free text ('ignore policy', 'admin override'). Recorded in ignored_inputs and otherwise inert.",
    caught_by: "guard",
  },
  {
    code: MistakeCode.CampaignStacking,
    disposition: "CLAMP",
    summary: "Two campaigns would compound. Only the single highest legal rung is applied.",
    caught_by: "route",
  },
  {
    code: MistakeCode.StaleCampaign,
    disposition: "ALLOW",
    summary: "A campaign outside its window is ignored; the proposal continues without it.",
    caught_by: "route",
  },
];

export function mistakeSpec(code: MistakeCode): MistakeSpec {
  const found = MISTAKE_CATALOG.find((m) => m.code === code);
  // The enum and the table are edited together; this is a safety net, not a path.
  if (found === undefined) {
    return {
      code,
      disposition: "REJECT",
      summary: "Unknown mistake code.",
      caught_by: "guard",
    };
  }
  return found;
}

// --------------------------------------------------------------------- findings

export interface Finding {
  code: MistakeCode;
  disposition: Disposition;
  message: string;
  detail: Record<string, string | number | boolean | null>;
}

function finding(
  code: MistakeCode,
  message: string,
  detail: Record<string, string | number | boolean | null> = {},
): Finding {
  return { code, disposition: mistakeSpec(code).disposition, message, detail };
}

// ------------------------------------------------------------- injection sniff

/**
 * Phrases that only ever appear when something is trying to talk its way past
 * policy. This is a tripwire for the demo and the audit trail — it is not the
 * control. The control is that free text has no path to a discount at all.
 */
const INJECTION_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /ignore (the )?(policy|rules|instructions)/i, label: "ignore policy" },
  { pattern: /admin (override|mode|access)/i, label: "admin override" },
  { pattern: /system prompt/i, label: "system prompt reference" },
  { pattern: /\b(grant|give|apply)\b.{0,20}\b(100|[1-9][0-9]?)\s*%/i, label: "discount instruction" },
  { pattern: /(make|set|charge).{0,15}(it|price|total).{0,10}(₹\s*)?1\b/i, label: "price override" },
  { pattern: /free of charge|for free|zero rupees/i, label: "free-of-charge instruction" },
];

export function detectInjection(text: string): string[] {
  const hits: string[] = [];
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(text) && !hits.includes(label)) hits.push(label);
  }
  return hits;
}

// ------------------------------------------------------------------- the guard

export interface GuardInput {
  catalog: Catalog;
  /** What the agent claims the cart is. */
  lines: CartLine[];
  currency: string;
  /** Attributes the agent claimed per sku, e.g. { sku_x: { size: "200ml" } }. */
  claimed_attributes?: Record<string, Record<string, string>>;
  /** Total the agent quoted in conversation, if it quoted one. */
  quoted_amount_paise?: number | null;
  /** Free text riding along with the request. */
  free_text?: string | null;
  /** SKUs the policy forbids selling through this channel. */
  blocked_product_ids: string[];
}

export interface GuardResult {
  ok: boolean;
  findings: Finding[];
  /** Present only when ok — the cart as the catalog says it really is. */
  cart: PricedCart | null;
  /** Human-readable list for ignored_inputs. */
  ignored_inputs: string[];
}

/**
 * Normalise a claimed cart against the catalog.
 *
 * REJECT findings stop the request; CLAMP findings rewrite it; ALLOW findings
 * are recorded and the request continues. The returned cart is always built
 * from catalog data, never from anything the agent asserted.
 */
export function guardCart(input: GuardInput): GuardResult {
  const findings: Finding[] = [];
  const ignored: string[] = [];

  if (input.currency !== "INR") {
    findings.push(
      finding(MistakeCode.CurrencyInvalid, `Currency ${input.currency} is not supported.`, {
        currency: input.currency,
      }),
    );
  }

  // Free text can never carry an instruction, but we log what it tried.
  const text = input.free_text ?? "";
  if (text !== "") {
    for (const label of detectInjection(text)) {
      findings.push(
        finding(MistakeCode.PromptInjection, `Injected instruction ignored: ${label}.`, {
          label,
        }),
      );
      ignored.push(`free_text: ${label} (instruction ignored)`);
    }
  }

  const normalised: CartLine[] = [];

  for (const line of input.lines) {
    const product = productById(input.catalog, line.sku_id);

    if (product === null) {
      findings.push(
        finding(MistakeCode.SkuHallucinated, `SKU ${line.sku_id} is not in the catalog.`, {
          sku_id: line.sku_id,
        }),
      );
      continue;
    }

    if (product.blocked || input.blocked_product_ids.includes(product.id)) {
      findings.push(
        finding(MistakeCode.BlockedSku, `We do not sell ${product.title} through the assistant.`, {
          sku_id: product.id,
        }),
      );
      continue;
    }

    if (product.availability !== "in_stock" || product.stock_qty <= 0) {
      findings.push(
        finding(MistakeCode.Oos, `${product.id} is out of stock.`, {
          sku_id: product.id,
          availability: product.availability,
        }),
      );
      continue;
    }

    // Claimed attributes must match the SKU actually being bought.
    const claimed = input.claimed_attributes?.[line.sku_id];
    if (claimed !== undefined) {
      for (const [key, value] of Object.entries(claimed)) {
        const actual = product.attributes[key];
        if (actual !== undefined && actual.toLowerCase() !== value.toLowerCase()) {
          findings.push(
            finding(
              MistakeCode.VariantMismatch,
              `${product.id} is ${key}=${actual}, not ${key}=${value}.`,
              { sku_id: product.id, attribute: key, claimed: value, actual },
            ),
          );
        }
      }
    }

    // Quantity is clamped, not refused: the buyer still gets what is sellable.
    const ceiling = Math.min(product.max_qty, product.stock_qty);
    let qty = line.qty;
    if (!Number.isInteger(qty) || qty < 1) qty = 1;
    if (qty > ceiling) {
      findings.push(
        finding(
          MistakeCode.QtyOverflow,
          `${product.id} quantity ${line.qty} clamped to ${ceiling}.`,
          { sku_id: product.id, requested: line.qty, clamped_to: ceiling },
        ),
      );
      qty = ceiling;
    }

    normalised.push({ sku_id: product.id, qty });
  }

  const hardStop = findings.some((f) => f.disposition === "REJECT");
  if (hardStop || normalised.length === 0) {
    if (normalised.length === 0 && !hardStop) {
      findings.push(
        finding(MistakeCode.SkuHallucinated, "No sellable line survived validation.", {}),
      );
    }
    return { ok: false, findings, cart: null, ignored_inputs: ignored };
  }

  const cart = priceCart(input.catalog, normalised);

  // The quoted number is compared, reported, and then thrown away.
  const quoted = input.quoted_amount_paise;
  if (quoted !== undefined && quoted !== null && quoted !== cart.amount_paise) {
    findings.push(
      finding(
        MistakeCode.PriceDrift,
        `Agent quoted ${quoted} paise; catalog says ${cart.amount_paise}. Catalog wins.`,
        { quoted_paise: quoted, catalog_paise: cart.amount_paise },
      ),
    );
    ignored.push(
      `quoted_amount_paise=${quoted} (price drift, catalog price ${cart.amount_paise} used)`,
    );
  }

  return { ok: true, findings, cart, ignored_inputs: ignored };
}
