/**
 * @countersign/vault
 *
 * The card vault: stores a payment instrument, and nothing else.
 *
 * **This vault does not charge anything.** S2S recon settled why — this account
 * has no headless card API, and `POST /v1/payments/create/json` answers
 * BAD_REQUEST_ERROR, "The requested URL was not found on the server". So the
 * live money path is a Razorpay Payment Link that the buyer completes on
 * Razorpay's own page (or on /gate through Checkout.js).
 *
 * A stored card exists for the day Razorpay enables server-to-server capture.
 * Until then it is held, masked, and never charged. Forging a captured payment
 * would be fraud, so there is deliberately no code here that could produce one.
 *
 * Rules this module keeps:
 *   - it never imports the kernel (a test greps the source for /kernel/)
 *   - the PAN never leaves this package
 *   - it never logs a token_id or a PAN; last4 only
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { SANDBOX_TEST_PAN } from "./secrets";

export const VAULT_VERSION = "0.2.0" as const;

/**
 * How money is actually taken on this build. Not a capture mode — there is no
 * capture here at all; the buyer completes a Razorpay Payment Link.
 */
export const SETTLEMENT_MODE = "razorpay_payment_link" as const;

/**
 * Razorpay's Indian test card, shown on /gate and /wallet so a human can type
 * it. Display only — no code in this repo transmits it anywhere. Kept in one
 * place so it is greppable and cannot spread.
 */
export const TEST_CARD_PAN_DISPLAY_ONLY = SANDBOX_TEST_PAN;

/** Formatted for a human to read off a screen. */
export function testCardDisplay(): string {
  return (TEST_CARD_PAN_DISPLAY_ONLY.match(/.{1,4}/g) ?? []).join(" ");
}

// ------------------------------------------------------------------ the types

export interface VaultToken {
  token_id: string;
  last4: string;
  brand: string;
}

/** Outcome of storing a card. Carries no PAN and no CVV, by construction. */
export interface VaultSaveResult {
  ok: boolean;
  token: VaultToken | null;
  error: string | null;
}

// ------------------------------------------------------------------- the seed

const SEEDED_TOKENS: ReadonlyMap<string, VaultToken> = new Map([
  ["demo", { token_id: "tok_demo_baron", last4: "5449", brand: "MC" }],
]);

/** Never render or log a token id — this is the only shape callers may show. */
export function maskToken(token: VaultToken): string {
  return `•••• ${token.last4}`;
}

// ------------------------------------------------------------- storing a card

/**
 * Accept a card for storage.
 *
 * The PAN and CVV are read, compared, and dropped on the floor inside this
 * function. Only `last4`, `brand` and a token id ever escape it — there is no
 * code path that writes a PAN to disk, to the audit log, or to a response.
 */
export function saveCard(input: {
  buyer_user_id: string;
  pan: string;
  cvv: string;
  expiry: string;
  name: string;
}): VaultSaveResult {
  const digits = input.pan.replace(/[\s-]/g, "");

  // Demo build: exactly one card is accepted, and it is the sandbox test card.
  if (digits !== TEST_CARD_PAN_DISPLAY_ONLY) {
    return {
      ok: false,
      token: null,
      error: "Only the Razorpay sandbox test card is accepted in this demo.",
    };
  }

  if (!/^\d{3,4}$/.test(input.cvv)) {
    return { ok: false, token: null, error: "CVV must be 3 or 4 digits." };
  }

  const token: VaultToken = {
    token_id: "tok_demo_baron",
    last4: digits.slice(-4),
    brand: "MC",
  };

  RUNTIME_TOKENS.set(input.buyer_user_id, token);

  // `digits` and `input.cvv` go out of scope here and are never persisted.
  return { ok: true, token, error: null };
}

// --------------------------------------------------------------- persistence

/**
 * Saved cards survive a restart.
 *
 * What is written is only ever `{ token_id, last4, brand }`. The PAN and CVV
 * never reach this file — they go out of scope inside `saveCard` and there is
 * no code path from them to disk.
 */
export function walletStorePath(): string {
  return resolve(process.env.WALLET_STORE_PATH ?? ".data/wallet.json");
}

interface WalletFile {
  version: 1;
  tokens: Record<string, VaultToken>;
}

function isVaultToken(value: unknown): value is VaultToken {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Partial<VaultToken>;
  return (
    typeof t.token_id === "string" &&
    typeof t.last4 === "string" &&
    t.last4.length === 4 &&
    typeof t.brand === "string"
  );
}

function readWalletFile(): Map<string, VaultToken> {
  const out = new Map<string, VaultToken>();
  const path = walletStorePath();
  if (!existsSync(path)) return out;

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const tokens = (parsed as Partial<WalletFile>).tokens;
    if (typeof tokens !== "object" || tokens === null) return out;

    for (const [buyer, token] of Object.entries(tokens)) {
      // A malformed row is skipped rather than taking the wallet down.
      if (isVaultToken(token)) out.set(buyer, token);
    }
  } catch {
    // An unreadable wallet file means "no card on file", never a crash.
  }
  return out;
}

function writeWalletFile(tokens: Map<string, VaultToken>): void {
  const path = walletStorePath();
  mkdirSync(dirname(path), { recursive: true });

  const file: WalletFile = { version: 1, tokens: Object.fromEntries(tokens) };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

const globalForWallet = globalThis as typeof globalThis & {
  __countersign_wallet?: Map<string, VaultToken>;
};

function tokens(): Map<string, VaultToken> {
  if (globalForWallet.__countersign_wallet === undefined) {
    globalForWallet.__countersign_wallet = readWalletFile();
  }
  return globalForWallet.__countersign_wallet;
}

const RUNTIME_TOKENS = {
  set(buyer: string, token: VaultToken): void {
    const map = tokens();
    map.set(buyer, token);
    writeWalletFile(map);
  },
  get(buyer: string): VaultToken | undefined {
    return tokens().get(buyer);
  },
  delete(buyer: string): void {
    const map = tokens();
    map.delete(buyer);
    writeWalletFile(map);
  },
};

export function storedToken(buyerUserId: string): VaultToken | null {
  return RUNTIME_TOKENS.get(buyerUserId) ?? null;
}

export function forgetCard(buyerUserId: string): void {
  RUNTIME_TOKENS.delete(buyerUserId);
}

/**
 * Drop the in-process cache so the next read comes from disk.
 *
 * This is what a fresh process would do on boot; tests use it to prove a saved
 * card really is on disk rather than only in memory.
 */
export function reloadWallet(): void {
  delete globalForWallet.__countersign_wallet;
}

// ------------------------------------------------------------ the boot notice

const globalForVault = globalThis as typeof globalThis & {
  __countersign_vault_booted?: boolean;
};

/**
 * Exactly one line, exactly once. Next reloads modules in dev, so the flag
 * lives on globalThis rather than in module scope.
 */
function announceOnce(): void {
  if (globalForVault.__countersign_vault_booted === true) return;
  globalForVault.__countersign_vault_booted = true;
  console.log(`BARON_SETTLEMENT=${SETTLEMENT_MODE}`);
}

// ----------------------------------------------------------------- the vault

/**
 * The card vault.
 *
 * Deliberately has no `charge()`. When Razorpay enables server-to-server
 * capture this class is where it goes; today there is no method here that could
 * be mistaken for one.
 */
export class Wallet {
  private readonly seeded: ReadonlyMap<string, VaultToken>;

  constructor(seeded: ReadonlyMap<string, VaultToken> = SEEDED_TOKENS) {
    this.seeded = seeded;
    announceOnce();
  }

  getToken(buyerUserId: string): VaultToken | null {
    // A card saved through /wallet wins over the seed.
    return storedToken(buyerUserId) ?? this.seeded.get(buyerUserId) ?? null;
  }
}

/** The process-wide vault. */
export const vault = new Wallet();
