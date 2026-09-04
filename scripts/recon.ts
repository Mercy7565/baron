/**
 * Day 1 recon — probe the Razorpay sandbox and record what it actually accepts.
 *
 * This is a throwaway investigation tool, not production code. It talks to the
 * live test-mode API, prints PASS/FAIL per probe, and appends the raw responses
 * to docs/SANDBOX_NOTES.md so we can reason about them later.
 *
 * Run with: pnpm recon
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const BASE_URL = "https://api.razorpay.com/v1";
const NOTES_PATH = "docs/SANDBOX_NOTES.md";

/** Suffix so repeated runs never collide on `receipt`. */
const RUN_ID = Date.now().toString(36);

// ---------------------------------------------------------------- env loading

function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    // Real environment wins over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// ------------------------------------------------------------------ http glue

interface Exchange {
  method: string;
  path: string;
  request: unknown;
  status: number;
  ok: boolean;
  body: unknown;
}

let authHeader = "";
let exchanges: Exchange[] = [];

/** The sandbox starts answering "Too many requests" if we push calls back to back. */
const THROTTLE_MS = 1500;
let lastCallAt = 0;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function call(method: string, path: string, request?: unknown): Promise<Exchange> {
  const waitFor = lastCallAt + THROTTLE_MS - Date.now();
  if (waitFor > 0) await sleep(waitFor);
  lastCallAt = Date.now();

  const init: RequestInit = {
    method,
    headers: {
      authorization: authHeader,
      "content-type": "application/json",
    },
  };
  if (request !== undefined) init.body = JSON.stringify(request);

  let status = 0;
  let ok = false;
  let body: unknown;

  // One retry on 429 so a throttled call is never mistaken for a real rejection.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, init);
      status = res.status;
      ok = res.ok;
      const raw = await res.text();
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = raw;
      }
    } catch (err) {
      body = { transport_error: err instanceof Error ? err.message : String(err) };
    }
    if (status !== 429) break;
    await sleep(5000);
    lastCallAt = Date.now();
  }

  const exchange: Exchange = { method, path, request: request ?? null, status, ok, body };
  exchanges.push(exchange);
  return exchange;
}

/** Pull Razorpay's human-readable error out of a failed response. */
function errorOf(ex: Exchange): string {
  const body = ex.body as { error?: { description?: string; field?: string } } | undefined;
  const description = body?.error?.description;
  const field = body?.error?.field;
  if (description !== undefined) {
    return field !== undefined ? `${description} (field: ${field})` : description;
  }
  if (typeof ex.body === "string" && ex.body !== "") return ex.body.slice(0, 200);
  return `HTTP ${ex.status}`;
}

function idOf(ex: Exchange): string {
  const body = ex.body as { id?: string } | undefined;
  return body?.id ?? "(no id)";
}

// --------------------------------------------------------------------- probes

interface Outcome {
  pass: boolean;
  reason: string;
}

interface Probe {
  n: number;
  title: string;
  run: () => Promise<Outcome>;
}

const orderBase = { amount: 50000, currency: "INR" } as const;

const probes: Probe[] = [
  {
    n: 1,
    title: "POST /orders — baseline amount=50000 currency=INR receipt=cs-recon-1",
    run: async () => {
      const ex = await call("POST", "/orders", { ...orderBase, receipt: "cs-recon-1" });
      return ex.ok
        ? { pass: true, reason: `created ${idOf(ex)}` }
        : { pass: false, reason: errorOf(ex) };
    },
  },

  {
    n: 2,
    title: "POST /orders — with CounterSign notes (decision_id, mandate_hash, inputs_hash, policy_version)",
    run: async () => {
      const notes = {
        decision_id: `dec_${RUN_ID}`,
        mandate_hash: "a".repeat(64),
        inputs_hash: "b".repeat(64),
        policy_version: "v0.1.0",
      };
      const ex = await call("POST", "/orders", {
        ...orderBase,
        receipt: `cs-recon-2-${RUN_ID}`,
        notes,
      });
      if (!ex.ok) return { pass: false, reason: errorOf(ex) };

      const echoed = (ex.body as { notes?: Record<string, unknown> }).notes ?? {};
      const missing = Object.keys(notes).filter(
        (k) => echoed[k] !== notes[k as keyof typeof notes],
      );
      return missing.length === 0
        ? { pass: true, reason: `all 4 note keys round-tripped intact on ${idOf(ex)}` }
        : { pass: false, reason: `notes altered or dropped: ${missing.join(", ")}` };
    },
  },

  {
    n: 3,
    title: "POST /orders — notes value length ceiling (100 / 200 / 256 / 512)",
    run: async () => {
      const lengths = [100, 200, 256, 512];
      const accepted: number[] = [];
      const rejected: string[] = [];

      for (const len of lengths) {
        const ex = await call("POST", "/orders", {
          ...orderBase,
          receipt: `cs-r3-${len}-${RUN_ID}`,
          notes: { probe: "x".repeat(len) },
        });
        if (ex.ok) {
          const echoed = (ex.body as { notes?: Record<string, string> }).notes?.probe ?? "";
          if (echoed.length === len) accepted.push(len);
          else rejected.push(`${len} truncated to ${echoed.length}`);
        } else {
          rejected.push(`${len} rejected ${ex.status}`);
        }
      }

      const summary = `accepted: ${accepted.join(", ") || "none"} | rejected: ${
        rejected.join("; ") || "none"
      }`;
      // The probe's job is to find the ceiling, not to have every length pass.
      return { pass: accepted.length > 0, reason: summary };
    },
  },

  {
    n: 4,
    title: "POST /orders — with line_items (report whether plain orders accept them)",
    run: async () => {
      const ex = await call("POST", "/orders", {
        ...orderBase,
        receipt: `cs-recon-4-${RUN_ID}`,
        line_items: [
          {
            name: "CounterSign recon item",
            price: 50000,
            quantity: 1,
            currency: "INR",
          },
        ],
      });
      return ex.ok
        ? { pass: true, reason: `accepted line_items on ${idOf(ex)}` }
        : { pass: false, reason: `rejected (${ex.status}): ${errorOf(ex)}` };
    },
  },

  {
    n: 5,
    title: "GET /offers — list offers available on this account",
    run: async () => {
      const ex = await call("GET", "/offers");
      if (!ex.ok) return { pass: false, reason: `${ex.status}: ${errorOf(ex)}` };
      const body = ex.body as { count?: number; items?: unknown[] };
      const count = body.count ?? body.items?.length ?? 0;
      return { pass: true, reason: `${count} offer(s) visible` };
    },
  },

  {
    n: 6,
    title: "POST /orders — offers: [{ offer_id }] + force_offer",
    run: async () => {
      const offerId = "offer_TXuWY6xddeXxVe";

      // A 200 is not enough here: the order can come back with offers: null,
      // meaning the field was accepted and then silently dropped.
      const attached = (ex: Exchange): boolean => {
        const offers = (ex.body as { offers?: unknown }).offers;
        return Array.isArray(offers) ? offers.length > 0 : false;
      };

      // Shape A: exactly as specified in the task.
      const a = await call("POST", "/orders", {
        ...orderBase,
        receipt: `cs-r6a-${RUN_ID}`,
        offers: [{ offer_id: offerId }],
        force_offer: 1,
      });
      if (a.ok && attached(a)) {
        return { pass: true, reason: `object shape + force_offer=1 attached on ${idOf(a)}` };
      }

      // Shape B: bare id strings and a boolean flag — Razorpay's documented form.
      const b = await call("POST", "/orders", {
        ...orderBase,
        receipt: `cs-r6b-${RUN_ID}`,
        offers: [offerId],
        force_offer: true,
      });
      if (b.ok && attached(b)) {
        return {
          pass: true,
          reason: `object shape did not attach; string-array shape attached on ${idOf(b)}`,
        };
      }

      const verdict = (ex: Exchange): string =>
        ex.ok ? `200 but offers=${JSON.stringify((ex.body as { offers?: unknown }).offers)}` : errorOf(ex);

      return {
        pass: false,
        reason: `offer not attached by either shape — A: ${verdict(a)} | B: ${verdict(b)}`,
      };
    },
  },

  {
    n: 7,
    title: "POST /payment_links — amount=50000",
    run: async () => {
      const ex = await call("POST", "/payment_links", {
        amount: 50000,
        currency: "INR",
        description: "CounterSign recon probe",
        reference_id: `cs-recon-7-${RUN_ID}`,
        // Nothing is delivered to anyone: this is a link-creation probe only.
        notify: { sms: false, email: false },
        reminder_enable: false,
      });
      if (!ex.ok) return { pass: false, reason: `${ex.status}: ${errorOf(ex)}` };
      const body = ex.body as { short_url?: string };
      return { pass: true, reason: `created ${idOf(ex)} ${body.short_url ?? ""}`.trim() };
    },
  },
];

// ------------------------------------------------------------------ reporting

function truncate(text: string, max = 1500): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more chars)`;
}

interface Report extends Outcome {
  n: number;
  title: string;
  exchanges: Exchange[];
}

function writeNotes(reports: Report[]): void {
  const stamp = new Date().toISOString();
  const fence = "```json";
  const lines: string[] = [
    "",
    "## Day 1 Recon",
    "",
    `Run \`${RUN_ID}\` — ${stamp} — against \`${BASE_URL}\` in test mode.`,
    "",
    "| # | Probe | Result | Reason |",
    "| --- | --- | --- | --- |",
  ];

  for (const r of reports) {
    const title = r.title.replace(/\|/g, "\\|");
    const reason = r.reason.replace(/\|/g, "\\|");
    lines.push(`| ${r.n} | ${title} | ${r.pass ? "PASS" : "FAIL"} | ${reason} |`);
  }

  lines.push("", "### Raw exchanges", "");

  for (const r of reports) {
    lines.push(
      `#### ${r.n}. ${r.title}`,
      "",
      `**${r.pass ? "PASS" : "FAIL"}** — ${r.reason}`,
      "",
    );
    for (const ex of r.exchanges) {
      lines.push(`\`${ex.method} ${ex.path}\` → \`${ex.status}\``, "");
      if (ex.request !== null) {
        lines.push("request:", fence, truncate(JSON.stringify(ex.request, null, 2), 800), "```", "");
      }
      lines.push("response:", fence, truncate(JSON.stringify(ex.body, null, 2)), "```", "");
    }
  }

  appendFileSync(NOTES_PATH, `${lines.join("\n")}\n`, "utf8");
}

// ----------------------------------------------------------------------- main

async function main(): Promise<void> {
  loadDotEnv();

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  console.log(`countersign recon — run ${RUN_ID}`);
  console.log(`base: ${BASE_URL}\n`);

  if (keyId === undefined || keyId === "" || keySecret === undefined || keySecret === "") {
    console.error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set. Fill in .env first.");
    process.exitCode = 1;
    return;
  }
  console.log(`key:  ${keyId}\n`);

  authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

  const reports: Report[] = [];
  for (const probe of probes) {
    exchanges = [];
    let outcome: Outcome;
    try {
      outcome = await probe.run();
    } catch (err) {
      outcome = { pass: false, reason: err instanceof Error ? err.message : String(err) };
    }
    reports.push({ n: probe.n, title: probe.title, ...outcome, exchanges });
    console.log(`${outcome.pass ? "PASS" : "FAIL"}  ${probe.n}. ${probe.title}`);
    console.log(`      ${outcome.reason}\n`);
  }

  writeNotes(reports);

  const passed = reports.filter((r) => r.pass).length;
  console.log(`${passed}/${reports.length} probes passed — raw responses appended to ${NOTES_PATH}`);
}

void main();
