/**
 * Replay a signed payment.captured at the local webhook.
 *
 * Razorpay cannot reach localhost, so without this you need a tunnel to get a
 * payment row into the audit trail. This signs the event with the same secret
 * the webhook verifies against, so it exercises the real HMAC path — it does
 * not bypass verification.
 *
 * Targets the newest CLAMP decision that produced an order, unless you pass an
 * order id.
 *
 * Run with: pnpm replay:webhook [order_id]
 */
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// Relative, not the package alias: this script runs from the repo root via
// tsx, where no workspace link for @countersign/ledger exists.
import { findLatestClampedOrder } from "../packages/ledger/src/index";

const WEBHOOK_URL =
  process.env.CS_WEBHOOK_URL ?? "http://localhost:3000/api/webhooks/razorpay";

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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (secret === undefined || secret === "") {
    console.error("RAZORPAY_WEBHOOK_SECRET is not set. Fill in .env first.");
    process.exitCode = 1;
    return;
  }

  // The audit log is written by the Next process, whose cwd is apps/web.
  if (process.env.AUDIT_LOG_PATH === undefined) {
    process.env.AUDIT_LOG_PATH = "apps/web/.data/audit.jsonl";
  }

  const argOrderId = process.argv[2];
  let orderId: string;

  if (argOrderId !== undefined && argOrderId !== "") {
    orderId = argOrderId;
  } else {
    const latest = findLatestClampedOrder();
    if (latest === null || latest.order_id === null) {
      console.error("No CLAMP order found in the audit log.");
      console.error("Click 'Ask 15%' at /demo first, or pass an order id as an argument.");
      process.exitCode = 1;
      return;
    }
    orderId = latest.order_id;
    console.log(`latest CLAMP order: ${orderId} (decision ${latest.decision_id ?? "?"})`);
  }

  const stamp = Date.now().toString(36);
  const eventId = `evt_replay_${stamp}`;
  const paymentId = `pay_replay_${stamp}`;

  const body = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    payload: {
      payment: { entity: { id: paymentId, order_id: orderId, status: "captured" } },
    },
  });

  const signature = createHmac("sha256", secret).update(body).digest("hex");

  console.log(`POST ${WEBHOOK_URL}`);
  console.log(`event_id: ${eventId}  payment_id: ${paymentId}\n`);

  let res: Response;
  try {
    res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": eventId,
      },
      body,
    });
  } catch (err) {
    console.error(`could not reach ${WEBHOOK_URL} — is the app running? (pnpm dev)`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text);

  if (res.status !== 200) {
    process.exitCode = 1;
    return;
  }
  console.log("\nreload /audit — a payment row should now be chained on top.");
}

void main();
