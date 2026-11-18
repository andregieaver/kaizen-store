/**
 * Orders after a message, by one rule (email plan M1.4, D761): a paid order counts for the latest email or text that reached the same person
 * within `ORDER_AFTER_DAYS` before it was placed, and for that one only. Used by broadcasts, automations, texts and Analytics → Marketing, so
 * one order is never counted twice and every screen says the same. An order the person would have placed anyway counts too: the figure says
 * what followed, not what the message caused. Pure: the database only finds the candidate pairs (`src/server/order-credit.ts`).
 */

/** An order this many days after a message counts as following it (D4 of `docs/100-day-challenge.md`). */
export const ORDER_AFTER_DAYS = 7;

/** One message that reached a person and one paid order that person placed, within the window. `key` names what sent it. */
export type CreditPair = { key: string; sentAt: string; orderId: string; placedAt: string; currency: string; totalMinor: number };

/** What a sender's messages brought: paid orders and their totals per currency. */
export type OrderCredit = { orders: number; minor: Record<string, number> };

const DAY_MS = 86_400_000;

/** Whether an order placed at `placedAt` follows a message sent at `sentAt`: after it, and within `ORDER_AFTER_DAYS`. */
function follows(sentAt: string, placedAt: string): boolean {
  const gap = Date.parse(placedAt) - Date.parse(sentAt);
  return Number.isFinite(gap) && gap > 0 && gap <= ORDER_AFTER_DAYS * DAY_MS;
}

/**
 * Each order credited once, to the latest message before it (ties go to the smaller key, so the answer never depends on the rows' order),
 * then summed per key: orders and totals per currency.
 */
export function creditOrders(pairs: readonly CreditPair[]): Map<string, OrderCredit> {
  const latest = new Map<string, CreditPair>();
  for (const pair of pairs) {
    if (!follows(pair.sentAt, pair.placedAt)) continue;
    const held = latest.get(pair.orderId);
    const later = !held || Date.parse(pair.sentAt) > Date.parse(held.sentAt) || (pair.sentAt === held.sentAt && pair.key < held.key);
    if (later) latest.set(pair.orderId, pair);
  }
  const credit = new Map<string, OrderCredit>();
  for (const pair of latest.values()) {
    const entry = credit.get(pair.key) ?? { orders: 0, minor: {} };
    entry.orders += 1;
    entry.minor[pair.currency] = (entry.minor[pair.currency] ?? 0) + pair.totalMinor;
    credit.set(pair.key, entry);
  }
  return credit;
}

/** The credit of one key, or nothing. */
export const creditOf = (credit: Map<string, OrderCredit>, key: string): OrderCredit => credit.get(key) ?? { orders: 0, minor: {} };
