import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { dayIn } from "@/lib/work-dates";
import { orderRight, type LineRight, type Refusal, type WithdrawalWindow } from "@/lib/withdrawal";

import { judge, loadFacts } from "./return-facts";
import { listOrderReturns, type OrderReturnRow } from "./returns";

/**
 * What an order's page says about returns (D153): the withdrawals and returns made on it, and where the order stands in
 * time (the 14 days of the right of withdrawal, the store's own longer window), judged by the same functions the customer's
 * withdrawal page uses. Null when the order is not the store's.
 */
export type OrderReturnsOverview = {
  orderId: string;
  returns: OrderReturnRow[];
  /** The order has been sent (a shipment is recorded): *Mark delivered* applies. */
  sent: boolean;
  /** The store day the goods were recorded as received; null until staff record it. It is what starts the 14 days. */
  deliveredOn: string | null;
  /**
   * Units withdrawn before anything was sent (a withdrawal return on an order with no shipment): they must stay out of the
   * parcel. Empty once the order has a shipment.
   */
  heldBack: { title: string; quantity: number }[];
  /** Every line with what can be withdrawn of it now, for staff registering a withdrawal that came outside the function. */
  lines: { lineId: string; title: string; quantity: number; remaining: number; maxQuantity: number; refusal: Refusal | null }[];
  /** Where the order stands in time; null for an order that cannot be withdrawn from at all (not paid, copied history). */
  window: WithdrawalWindow | null;
  /** What the customer can do with the order as a whole now. */
  right: LineRight;
  /** Units that can still be withdrawn or returned, of the units bought on physical lines and the rest. */
  unitsLeft: number;
  unitsBought: number;
  business: boolean;
  copied: boolean;
};

export async function orderReturnsOverview(storeId: string, orderId: string, now = new Date()): Promise<OrderReturnsOverview | null> {
  const [facts, returns] = await Promise.all([loadFacts(storeId, orderId), listOrderReturns(storeId, orderId)]);
  if (!facts) return null;
  const { lines, window } = judge(facts, now);
  const paid = ["paid", "fulfilled", "closed"].includes(facts.status);
  const sent = facts.order.lastShippedAt !== null;
  const held = sent
    ? []
    : await db().execute<Record<string, unknown>>(sql`
        select ol.title, sum(rl.quantity)::int as quantity
        from commerce.return_lines rl
        join commerce.returns r on r.store_id = rl.store_id and r.id = rl.return_id
        join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
        where rl.store_id = ${storeId}::uuid and r.order_id = ${orderId}::uuid and r.kind = 'withdrawal' and rl.decision = 'accept'
          and r.status::text not in ('declined', 'cancelled') and ol.delivery = 'physical'
        group by ol.title order by ol.title
      `);
  return {
    orderId,
    sent,
    deliveredOn: facts.order.deliveredAt ? dayIn(facts.order.deliveredAt, facts.timeZone) : null,
    heldBack: held.map((row) => ({ title: String(row.title), quantity: Number(row.quantity) })),
    lines: lines.map((eligibility) => {
      const line = facts.lines.find((l) => l.id === eligibility.lineId)!;
      return {
        lineId: line.id,
        title: line.title,
        quantity: line.quantity,
        remaining: eligibility.remaining,
        maxQuantity: eligibility.maxQuantity,
        refusal: eligibility.refusal,
      };
    }),
    returns,
    window: paid && !facts.order.copied ? window : null,
    right: orderRight(lines),
    unitsLeft: lines.reduce((sum, line) => sum + line.maxQuantity, 0),
    unitsBought: facts.lines.reduce((sum, line) => sum + line.quantity, 0),
    business: facts.order.business,
    copied: facts.order.copied,
  };
}
