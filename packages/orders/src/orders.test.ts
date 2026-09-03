import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type Order,
  allOrders,
  appendOrder,
  explainOrder,
  getOrder,
  loadOrders,
  markClosed,
  markPaid,
  ordersByStatus,
  paidOrdersFor,
  reloadOrders,
  unpaidOrdersFor,
} from "./index";

let dir: string;

const order = (over: Partial<Order> = {}): Order => ({
  order_id: "qt_test_1",
  quote_id: "qt_test_1",
  buyer_user_id: "demo",
  agent_id: "baron_shop_agent",
  razorpay_order_id: "order_abc",
  payment_link_id: "plink_abc",
  short_url: "https://rzp.io/rzp/abc",
  amount_paise: 204_060,
  asked_bps: 1500,
  applied_bps: 500,
  offer_id: "offer_TXZFaRi7PFRQyz",
  verdict: "CLAMP",
  lines: [{ sku_id: "sku_a", title: "A serum", qty: 1, line_total_paise: 204_060 }],
  status: "awaiting_payment",
  razorpay_payment_id: null,
  created_at: "2026-09-02T00:00:00.000Z",
  paid_at: null,
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cs-orders-"));
  process.env.ORDERS_LOG_PATH = join(dir, "orders.jsonl");
  reloadOrders();
});

afterEach(() => {
  delete process.env.ORDERS_LOG_PATH;
  reloadOrders();
  rmSync(dir, { recursive: true, force: true });
});

describe("unpaid is never revenue", () => {
  it("an issued link does not appear on the customer's paid list", () => {
    appendOrder(order());

    expect(allOrders()).toHaveLength(1);
    // The link exists, the payment does not.
    expect(paidOrdersFor("demo")).toEqual([]);
    expect(ordersByStatus("awaiting_payment")).toHaveLength(1);
    expect(ordersByStatus("paid")).toEqual([]);
  });

  it("appears once Razorpay reports a payment against it", () => {
    appendOrder(order());
    markPaid("qt_test_1", "pay_RealRazorpayId");

    const paid = paidOrdersFor("demo");
    expect(paid).toHaveLength(1);
    expect(paid[0]?.razorpay_payment_id).toBe("pay_RealRazorpayId");
    expect(paid[0]?.paid_at).not.toBeNull();
  });

  it("refuses to mark an order paid without a payment id", () => {
    appendOrder(order());

    // An order with no payment id is not a paid order, so this must be a no-op.
    expect(markPaid("qt_test_1", "")).toBeNull();
    expect(paidOrdersFor("demo")).toEqual([]);
  });

  it("only shows a customer their own orders", () => {
    appendOrder(order({ order_id: "mine", status: "paid", razorpay_payment_id: "pay_1" }));
    appendOrder(
      order({
        order_id: "theirs",
        buyer_user_id: "someone_else",
        status: "paid",
        razorpay_payment_id: "pay_2",
      }),
    );

    expect(paidOrdersFor("demo").map((o) => o.order_id)).toEqual(["mine"]);
  });
});

describe("disk memory, not RAM", () => {
  it("a merchant reader sees a customer-created paid row from disk alone", () => {
    // The customer's process writes.
    appendOrder(order({ order_id: "cross_process", status: "awaiting_payment" }));
    markPaid("cross_process", "pay_FromRazorpay");

    // A different process starts: no shared memory, only the file.
    reloadOrders();

    const fromDisk = getOrder("cross_process");
    expect(fromDisk?.status).toBe("paid");
    expect(fromDisk?.razorpay_payment_id).toBe("pay_FromRazorpay");
    expect(ordersByStatus("paid").map((o) => o.order_id)).toContain("cross_process");
  });

  it("the last write for an order wins after a rebuild", () => {
    appendOrder(order({ order_id: "seq" }));
    markPaid("seq", "pay_x");
    reloadOrders();

    // Both rows are on disk; the index must land on the later one.
    expect(loadOrders().get("seq")?.status).toBe("paid");
  });

  it("survives a torn line without losing the good rows", () => {
    appendOrder(order({ order_id: "good" }));

    const { appendFileSync } = require("node:fs") as typeof import("node:fs");
    appendFileSync(process.env.ORDERS_LOG_PATH as string, "{ not json\n", "utf8");

    reloadOrders();
    expect(getOrder("good")).not.toBeNull();
  });
});

describe("the sentence a customer reads", () => {
  it("says what was asked, what was allowed, and whether it is paid", () => {
    const unpaid = explainOrder(order());
    expect(unpaid).toContain("asked for 15%");
    expect(unpaid).toContain("allowed 5%");
    expect(unpaid).toContain("awaiting payment");

    appendOrder(order());
    const paid = markPaid("qt_test_1", "pay_Zed");
    expect(explainOrder(paid as Order)).toContain("pay_Zed");
  });

  it("never contains a card number or a step-up code", () => {
    const text = explainOrder(order({ status: "paid", razorpay_payment_id: "pay_1" }));
    expect(text).not.toContain("5267");
    expect(text).not.toContain("1234");
  });
});

describe("an unpaid link the buyer walks away from", () => {
  it("shows up on the customer's unpaid list the moment it is issued", () => {
    appendOrder(order());

    const unpaid = unpaidOrdersFor("demo");
    expect(unpaid).toHaveLength(1);
    // The short_url has to survive issuance, or there is nothing to open.
    expect(unpaid[0]?.short_url).toBe("https://rzp.io/rzp/abc");
    expect(paidOrdersFor("demo")).toHaveLength(0);
  });

  it("disappears from unpaid once closed, without becoming paid", () => {
    appendOrder(order());

    const closed = markClosed("qt_test_1", true);
    expect(closed?.status).toBe("closed");
    expect(closed?.cancelled_at_razorpay).toBe(true);
    expect(closed?.closed_at).not.toBeNull();

    expect(unpaidOrdersFor("demo")).toHaveLength(0);
    // Closing is the opposite of paying. It must never manufacture revenue.
    expect(paidOrdersFor("demo")).toHaveLength(0);
    expect(closed?.razorpay_payment_id).toBeNull();
    expect(closed?.paid_at).toBeNull();
  });

  it("drops out of the merchant's awaiting list and into closed", () => {
    appendOrder(order());
    expect(ordersByStatus("awaiting_payment")).toHaveLength(1);

    markClosed("qt_test_1", true);

    expect(ordersByStatus("awaiting_payment")).toHaveLength(0);
    expect(ordersByStatus("closed")).toHaveLength(1);
    expect(ordersByStatus("paid")).toHaveLength(0);
  });

  it("records when Razorpay refused the cancel, rather than claiming it worked", () => {
    appendOrder(order());
    const closed = markClosed("qt_test_1", false);

    expect(closed?.status).toBe("closed");
    expect(closed?.cancelled_at_razorpay).toBe(false);
  });

  it("refuses to close an order that is already paid", () => {
    appendOrder(order());
    markPaid("qt_test_1", "pay_from_razorpay");

    expect(markClosed("qt_test_1", true)).toBeNull();
    expect(getOrder("qt_test_1")?.status).toBe("paid");
  });

  it("survives a restart, so a closed link does not come back as unpaid", () => {
    appendOrder(order());
    markClosed("qt_test_1", true);

    reloadOrders();
    loadOrders(true);

    expect(unpaidOrdersFor("demo")).toHaveLength(0);
    expect(getOrder("qt_test_1")?.status).toBe("closed");
  });
});

describe("a payment is recorded once, so budget cannot double-count", () => {
  it("markPaid returns the order on the transition and null afterwards", () => {
    appendOrder(order());

    const first = markPaid("qt_test_1", "pay_from_razorpay");
    expect(first?.status).toBe("paid");

    // The refresh endpoint is polled. Campaign budget is burned on a non-null
    // result, so a second call must not look like a second payment.
    expect(markPaid("qt_test_1", "pay_from_razorpay")).toBeNull();
    expect(getOrder("qt_test_1")?.status).toBe("paid");
  });
});
