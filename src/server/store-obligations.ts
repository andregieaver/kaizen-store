import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { Obligations } from "@/lib/store-closure";

import { col, typedRow } from "./typed-rows";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Executor = Pick<ReturnType<typeof db>, "execute"> | Tx;

/**
 * What a store still has open, counted now. A paid order is *to send* while it holds goods and its payment is a real one (a test payment is no
 * obligation); a subscription or a weekly list is running while customers expect the next delivery.
 */
export async function storeObligations(
  storeId: string,
  executor: Executor = db(),
): Promise<Obligations> {
  // Typed on the way over (the ratchet admits no new unchecked read, so the moved read is checked, not carried): the counts are `int`, `live_plan` a boolean.
  const row = await typedRow(
    z.object({
      paid_unshipped: col.int,
      subscriptions: col.int,
      deliveries: col.int,
      checkouts: col.int,
      bookings: col.int,
      returns: col.int,
      live_plan: col.bool,
      domains: col.int,
    }),
    sql`
    select
      (select count(*)::int from commerce.orders o
        where o.store_id = ${storeId}::uuid and o.status = 'paid' and o.copied_from is null
          and exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical' and not l.gift)
          and not coalesce((select bool_and(p.test_mode) from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id), false)
      ) as paid_unshipped,
      (select count(*)::int from commerce.subscriptions s where s.store_id = ${storeId}::uuid and s.status in ('active', 'past_due', 'paused')) as subscriptions,
      (select count(*)::int from commerce.standing_orders d where d.store_id = ${storeId}::uuid and d.status in ('active', 'paused')) as deliveries,
      (select count(*)::int from commerce.orders o where o.store_id = ${storeId}::uuid and o.status = 'pending_payment' and o.copied_from is null) as checkouts,
      (select count(*)::int from commerce.bookings b where b.store_id = ${storeId}::uuid and b.status in ('held', 'confirmed') and b.starts_at > now()) as bookings,
      (select count(*)::int from commerce.returns r where r.store_id = ${storeId}::uuid and r.status in ('requested', 'approved', 'in_transit', 'received', 'inspected')) as returns,
      exists (select 1 from commerce.store_billing b where b.store_id = ${storeId}::uuid and b.subscription_id is not null
        and coalesce(b.status, '') not in ('canceled', 'incomplete_expired') and not b.cancel_at_period_end) as live_plan,
      (select count(*)::int from commerce.store_domains d where d.store_id = ${storeId}::uuid) as domains
  `,
    executor,
  );
  return {
    paidUnshipped: Number(row?.paid_unshipped ?? 0),
    runningSubscriptions: Number(row?.subscriptions ?? 0),
    runningDeliveries: Number(row?.deliveries ?? 0),
    openCheckouts: Number(row?.checkouts ?? 0),
    futureBookings: Number(row?.bookings ?? 0),
    openReturns: Number(row?.returns ?? 0),
    livePlan: Boolean(row?.live_plan),
    domains: Number(row?.domains ?? 0),
  };
}
