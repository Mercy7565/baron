import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";

import type { Role } from "@/server/session";

/**
 * Accounts, for a demo.
 *
 * Deliberately not Cognito, not OAuth, not a database. Judges need to sign in
 * as a merchant and as a shopper within a five-minute video, so any new
 * username and password is accepted and stored, and two fixed accounts always
 * work. What this is *not* is an authentication story: it exists so the two
 * sides of the product can be shown, and the honest thing is to say so rather
 * than to dress a demo up as a security boundary.
 *
 * Passwords are salted and hashed anyway. Not because this protects anything
 * that matters here, but because writing plaintext passwords to disk is a habit
 * worth never forming, and someone will reuse a password they care about.
 */

export interface StoredUser {
  username: string;
  role: Role;
  salt: string;
  hash: string;
  /** Which merchant this account belongs to. One tenant for now. */
  tenant_id: string;
  created_at: string;
}

interface UserFile {
  version: 1;
  users: StoredUser[];
}

/** The one real merchant in this build: the skincare shop already loaded. */
export const DEFAULT_TENANT = "baron_skincare";

/**
 * Accounts that always work, whatever is on disk.
 *
 * A demo that can be locked out by a stale data file is not a demo. These two
 * are checked before the stored users and cannot be overwritten by a signup.
 */
const BUILT_IN: Array<{ username: string; password: string; role: Role }> = [
  { username: "merchant", password: "merchant", role: "merchant" },
  { username: "aryan", password: "aryan", role: "customer" },
];

export function usersPath(): string {
  return resolve(process.env.USERS_PATH ?? ".data/users.json");
}

function readUsers(): UserFile {
  const path = usersPath();
  if (!existsSync(path)) return { version: 1, users: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<UserFile>;
    return { version: 1, users: parsed.users ?? [] };
  } catch {
    // A corrupt file means "no accounts yet", never a broken sign-in — the
    // built-ins below still work.
    return { version: 1, users: [] };
  }
}

function writeUsers(file: UserFile): void {
  const path = usersPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`, "utf8").digest("hex");
}

/** Constant-time compare, so a wrong password cannot be found a byte at a time. */
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

function builtIn(username: string): (typeof BUILT_IN)[number] | undefined {
  return BUILT_IN.find((u) => u.username === username.trim().toLowerCase());
}

export function isBuiltIn(username: string): boolean {
  return builtIn(username) !== undefined;
}

export interface AuthResult {
  ok: boolean;
  role?: Role;
  username?: string;
  tenant_id?: string;
  error?: string;
}

/**
 * Sign in.
 *
 * The built-in pair is checked first and its role is fixed: someone signing in
 * as `merchant` gets the merchant console whatever the form said, because the
 * whole point of those two accounts is that they land where the video needs
 * them to.
 */
export function authenticate(username: string, password: string): AuthResult {
  const name = username.trim().toLowerCase();
  if (name === "" || password === "") {
    return { ok: false, error: "Enter a username and a password." };
  }

  const fixed = builtIn(name);
  if (fixed !== undefined) {
    if (password !== fixed.password) return { ok: false, error: "That password is not right." };
    return { ok: true, role: fixed.role, username: name, tenant_id: DEFAULT_TENANT };
  }

  const user = readUsers().users.find((u) => u.username === name);
  if (user === undefined) {
    return { ok: false, error: "No account with that username. Create one instead." };
  }
  if (!sameHash(user.hash, hashPassword(password, user.salt))) {
    return { ok: false, error: "That password is not right." };
  }

  return { ok: true, role: user.role, username: name, tenant_id: user.tenant_id };
}

/**
 * Create an account.
 *
 * Any username and any password are accepted — the only rules are that the name
 * is free and neither field is empty. A merchant account starts with no shop
 * code, because a code is earned by loading a catalog, not by signing up.
 */
export function register(username: string, password: string, role: Role): AuthResult {
  const name = username.trim().toLowerCase();
  if (name === "" || password === "") {
    return { ok: false, error: "Enter a username and a password." };
  }
  if (builtIn(name) !== undefined) {
    return { ok: false, error: "That username is reserved for the demo account." };
  }

  const file = readUsers();
  if (file.users.some((u) => u.username === name)) {
    return { ok: false, error: "That username is taken. Sign in instead." };
  }

  const salt = randomBytes(16).toString("hex");
  file.users.push({
    username: name,
    role,
    salt,
    hash: hashPassword(password, salt),
    // Every account points at the one real tenant. A second merchant would
    // need a catalog of its own, and that is not this turn.
    tenant_id: DEFAULT_TENANT,
    created_at: new Date().toISOString(),
  });
  writeUsers(file);

  return { ok: true, role, username: name, tenant_id: DEFAULT_TENANT };
}
