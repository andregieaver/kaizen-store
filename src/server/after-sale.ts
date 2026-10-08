import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db } from "@/db/client";
import { RETURN_STATUSES, isEnded } from "@/lib/return-status";
import { afterSaleIsOpen, type AfterSale } from "@/lib/store-features";
import { MAX_WINDOW_DAYS, lineEligibility, type WithdrawalOrder } from "@/lib/withdrawal";

import { toSettings } from "./return-settings";

/**
 * What is still open after the sale in a store (D178 step 5, `docs/store-features.md` 4e): orders a shopper can still withdraw from or
 * return, and returns not ended. With the online shop off, the admin's Orders (out of the navigation) and the storefront's withdrawal link
 * stay while either is; then both go. Nothing here decides a right of its own: every line is judged by `lineEligibility()` (the 14 days,
 * the store's own window, sealed and excluded goods, business orders) exactly as the withdrawal function judges it, and a return is open
 * while `isEnded()` says it is not.
 *
 * An order sent and not recorded as received keeps the right open (`withdrawalWindow()`: the period starts on receipt, never on an
 * estimate), so such an order keeps after-sale open until staff record its delivery.
 */

type Row = Record<string, unknown>;

/** The returns that are over (`closed`, `declined`, `cancelled`): every other status is still open. */
const ENDED = RETURN_STATUSES.filter(isEnded);
const ENDED_LIST = sql.raw(`array[${ENDED.map((s) => `'${s}'`).join(", ")}]::text[]`);

/** Orders delivered longer ago than the longest window a store can have (and a day each side for time zones) have nothing left to judge. */
const LOOK_BACK_DAYS = MAX_WINDOW_DAYS + 2;

/** Counts what is open after the sale in a store now: orders with a line that can still be withdrawn from or returned, and open returns. */
export async function afterSaleOf(storeId: string, now: Date = new Date()): Promise<AfterSale> {
  const [[counts], lines] = await Promise.all([
    db().execute<Row>(sql`
      select (select count(*)::int from commerce.returns r where r.store_id = ${storeId}::uuid and r.status::text <> all (${ENDED_LIST})) as open_returns,
        s.time_zone, to_jsonb(rs) as settings
      from commerce.stores s left join commerce.return_settings rs on rs.store_id = s.id
      where s.id = ${storeId}::uuid
    `),
    // Paid orders of the store's own (never copied ones) that are not past every window: each line with what returns and closures took.
    db().execute<Row>(sql`
      select o.id as order_id, o.status, o.delivered_at, o.company_name, o.subscription_id, o.digital_consent_at,
        (select max(sh.created_at) from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id and sh.undone_at is null) as last_shipped_at,
        ol.id as line_id, ol.quantity, ol.delivery, ol.withdrawal_exclusion,
        commerce.returned_quantity(ol.id) + commerce.closed_quantity(ol.id) as taken
      from commerce.orders o
      join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
      where o.store_id = ${storeId}::uuid and o.copied_from is null and o.status in ('paid', 'fulfilled', 'closed')
        and (o.delivered_at is null or o.delivered_at > ${now.toISOString()}::timestamptz - make_interval(days => ${LOOK_BACK_DAYS}))
    `),
  ]);
  if (!counts) return { withdrawable: 0, openReturns: 0 };
  const settings = toSettings(counts.settings ? (counts.settings as Row) : undefined);
  const timeZone = String(counts.time_zone ?? "Europe/Oslo");
  const open = new Set<string>();
  for (const row of lines) {
    const orderId = String(row.order_id);
    if (open.has(orderId)) continue;
    const order: WithdrawalOrder = {
      status: String(row.status),
      copied: false,
      business: Boolean(row.company_name && String(row.company_name).trim()),
      deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)) : null,
      lastShippedAt: row.last_shipped_at ? new Date(String(row.last_shipped_at)) : null,
      subscription: Boolean(row.subscription_id),
      digitalConsent: Boolean(row.digital_consent_at),
    };
    const eligibility = lineEligibility(
      {
        id: String(row.line_id),
        quantity: Number(row.quantity),
        delivery: String(row.delivery),
        withdrawalExclusion: String(row.withdrawal_exclusion),
        takenQuantity: Number(row.taken),
      },
      order,
      settings,
      timeZone,
      now,
    );
    if (eligibility.right !== "none") open.add(orderId);
  }
  return { withdrawable: open.size, openReturns: Number(counts.open_returns ?? 0) };
}

/** Whether anything after the sale is still open in a store now (`afterSaleOf()`). */
export async function afterSaleOpen(storeId: string, now: Date = new Date()): Promise<boolean> {
  return afterSaleIsOpen(await afterSaleOf(storeId, now));
}

export const afterSaleTag = (storeId: string) => `after-sale:${storeId}`;

/**
 * The same for the storefront's footer and legal links while the shop is off (D178 step 5): cached for an hour (a window closes at a store
 * day's end, and a return that ends leaves the link up to an hour longer, never shorter), refreshed with the store's features. Asked only of
 * a store whose shop is off: with the shop on, the link is always there.
 */
export async function afterSaleOpenCached(storeId: string): Promise<boolean> {
  "use cache";
  cacheTag(afterSaleTag(storeId));
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 });
  return afterSaleOpen(storeId);
}
