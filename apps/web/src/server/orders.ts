import { allQuotes } from "@countersign/quotes";

/**
 * Demo fulfilment. There is no courier and no warehouse — the stage is derived
 * from how long ago the payment happened, purely so the video has something
 * honest to show after "Order received".
 */
export type OrderStage = "received" | "packing" | "out_for_delivery";

export const STAGES: OrderStage[] = ["received", "packing", "out_for_delivery"];

export interface DemoOrder {
  quote_id: string;
  order_id: string | null;
  payment_id: string;
  paid_at: string;
  amount_paise: number;
  lines: Array<{ sku_id: string; title: string; qty: number }>;
  stage: OrderStage;
}

/** One stage per 30 seconds, so the demo can show movement without waiting. */
function stageFor(paidAt: string, now: Date): OrderStage {
  const elapsed = now.getTime() - Date.parse(paidAt);
  if (Number.isNaN(elapsed) || elapsed < 30_000) return "received";
  if (elapsed < 60_000) return "packing";
  return "out_for_delivery";
}

export function listOrders(now = new Date()): DemoOrder[] {
  return allQuotes()
    .filter((q) => q.payment_id !== null)
    .map((q) => ({
      quote_id: q.quote_id,
      order_id: q.order_id,
      payment_id: q.payment_id as string,
      paid_at: q.created_at,
      amount_paise: q.legal_total_paise,
      lines: q.lines.map((l) => ({ sku_id: l.sku_id, title: l.title, qty: l.qty })),
      stage: stageFor(q.created_at, now),
    }))
    .sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1));
}
