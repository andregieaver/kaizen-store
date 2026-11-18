import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { creditOf, creditOrders, ORDER_AFTER_DAYS, type OrderCredit } from "@/lib/order-credit";

import { PAID } from "./analytics-sql";
import { col, typedRows } from "./typed-rows";

/**
 * Orders after a store's emails and texts (email plan M1.4, D761): the database finds each paid order placed in the period and every message
 * that reached the same person (their address, or their customer account) in the `ORDER_AFTER_DAYS` before it, from all three senders at
 * once; `creditOrders()` gives each order to the latest one. Keys: `broadcast:{id}`, `automation:{kind}` and `text:{campaign}`.
 */

/** A paid order as D152 counts it, still the person's (never restricted or anonymised), not cancelled. */
const SOLD = sql`(${PAID} and o.status in ('paid', 'fulfilled', 'closed') and o.restricted_at is null and o.anonymised_at is null)`;

const pairRow = z.object({
  key: col.text,
  sent_at: col.timestamp,
  order_id: col.uuid,
  placed_at: col.timestamp,
  currency: col.currency,
  total_minor: col.minor,
});

/** An instant: a `Date`, or a timestamptz in SQL (an analytics period's day start in the store's zone, `dayStart()`). */
type Instant = Date | SQL;
const at = (v: Instant): SQL => (v instanceof Date ? sql`${v.toISOString()}::timestamptz` : sql`(${v})`);

/** The credit per sender for the paid orders a store's customers placed from `from` (inclusive) to `to` (inclusive). */
export async function orderCredit(storeId: string, from: Instant, to: Instant): Promise<Map<string, OrderCredit>> {
  // Messages before the period's first order's window cannot be credited: each sender reads from there on.
  const since = sql`(${at(from)} - make_interval(days => ${ORDER_AFTER_DAYS}))`;
  const until = at(to);
  const rows = await typedRows(
    pairRow,
    sql`
      with sold as (
        select o.id, lower(o.email) as email, o.customer_id, o.placed_at, o.currency, o.total_minor
          from commerce.orders o
         where o.store_id = ${storeId}::uuid and o.placed_at >= ${at(from)} and o.placed_at <= ${until}
           and ${SOLD}
      ),
      sent as (
        select 'broadcast:' || r.broadcast_id::text as key, r.sent_at, r.email, null::uuid as customer_id
          from commerce.broadcast_recipients r
         where r.store_id = ${storeId}::uuid and r.status = 'sent' and r.sent_at >= ${since} and r.sent_at <= ${until}
        union all
        select 'automation:' || s.kind, s.created_at, lower(m.email), m.customer_id
          from commerce.automation_sends s
          join commerce.marketing_subscribers m on m.store_id = s.store_id and m.id = s.subscriber_id
         where s.store_id = ${storeId}::uuid and s.outcome in ('sent', 'logged') and s.created_at >= ${since} and s.created_at <= ${until}
        union all
        select 'text:' || t.campaign_id::text, t.sent_at, lower(p.email), p.customer_id
          from commerce.sms_messages t
          join commerce.sms_subscribers p on p.store_id = t.store_id and p.id = t.subscriber_id
         where t.store_id = ${storeId}::uuid and t.status in ('sent', 'delivered') and t.sent_at >= ${since} and t.sent_at <= ${until}
      )
      select x.key, x.sent_at, o.id as order_id, o.placed_at, o.currency, o.total_minor
        from sold o
        join sent x on (x.email = o.email or (x.customer_id is not null and x.customer_id = o.customer_id))
         and x.sent_at < o.placed_at and x.sent_at >= o.placed_at - make_interval(days => ${ORDER_AFTER_DAYS})
    `,
  );
  return creditOrders(
    rows.map((r) => ({ key: r.key, sentAt: r.sent_at, orderId: r.order_id, placedAt: r.placed_at, currency: r.currency, totalMinor: r.total_minor })),
  );
}

/**
 * What one send was credited with (a broadcast's `broadcast:{id}`, a text's `text:{campaign}`): the orders placed from its start to
 * `ORDER_AFTER_DAYS` after it ended (or now), by the one rule, so a later message to the same buyer takes the order when it came after.
 */
export async function sendCredit(storeId: string, key: string, startedAt: string | null, finishedAt: string | null): Promise<OrderCredit> {
  if (!startedAt) return { orders: 0, minor: {} };
  const end = Math.min(Date.now(), new Date(finishedAt ?? Date.now()).getTime() + ORDER_AFTER_DAYS * 86_400_000);
  return creditOf(await orderCredit(storeId, new Date(startedAt), new Date(end)), key);
}

/** The three senders a store's messages come from. */
export const SOURCES = ["broadcast", "automation", "text"] as const;
export type CreditSource = (typeof SOURCES)[number];

/** The credit of a period summed per sender kind (Analytics → Marketing): each order still counted once, for the latest message before it. */
export async function creditBySource(storeId: string, from: Instant, to: Instant): Promise<Record<CreditSource, OrderCredit>> {
  const credit = await orderCredit(storeId, from, to);
  const sums = Object.fromEntries(SOURCES.map((s) => [s, { orders: 0, minor: {} as Record<string, number> }])) as Record<CreditSource, OrderCredit>;
  for (const [key, entry] of credit) {
    const source = key.slice(0, key.indexOf(":")) as CreditSource;
    if (!sums[source]) continue;
    sums[source].orders += entry.orders;
    for (const [currency, minor] of Object.entries(entry.minor)) sums[source].minor[currency] = (sums[source].minor[currency] ?? 0) + minor;
  }
  return sums;
}
