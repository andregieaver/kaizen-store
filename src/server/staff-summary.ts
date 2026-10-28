import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { addDays, customPeriod, daysBetween } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";

import { periodTotals } from "./analytics-totals";
import { PHYSICAL_SQL } from "./order-list-sql";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The figures of the staff summary email (wave 3, D238, `docs/wave-3-notifications.md` 2.8, `docs/analytics.md` *Staff summary*): the period's paid orders
 * and net sales without VAT in the store's main currency (D152's `periodTotals()`, so a currency without a rate is left out and counted, never summed), its
 * refunds, the returns requested in it, and what is open now (returns, orders to send, variants at or below their level, conversations waiting in support
 * when the desk is on). Counts and the store's own sums only: nothing per customer. Every query names the store.
 */

export type StaffSummaryFigures = {
  from: string;
  to: string;
  /** Paid orders of the period (D152 `PAID`). */
  orders: number;
  /** Revenue less refunds, without VAT, in the main currency. */
  netSalesMinor: number;
  refundsMinor: number;
  currency: string;
  /** Paid orders and refunds left out for want of an exchange rate, and their currencies. */
  unconverted: number;
  missingCurrencies: string[];
  returnsRequested: number;
  openReturns: number;
  toSend: number;
  lowStock: number;
  /** Null while the store's support desk is off. */
  supportWaiting: number | null;
  /** The period before, as long (D348's briefing sets the two side by side); null when a currency of either had no rate. */
  before?: { orders: number; netSalesMinor: number } | null;
};

/** The summary's figures for the store days `from` to `to` (both included), and what is open at the time it is built. */
export async function staffSummaryFigures(store: Store, period: { from: string; to: string }): Promise<StaffSummaryFigures> {
  const p = customPeriod(period.from, period.to);
  const length = daysBetween(period.from, addDays(period.to, 1));
  const [totals, previous, [counts]] = await Promise.all([
    periodTotals(store, p),
    periodTotals(store, customPeriod(addDays(period.from, -length), addDays(period.from, -1))),
    db().execute<Row>(sql`
      select
        (select count(*)::int from commerce.returns r join commerce.stores s on s.id = r.store_id
          where r.store_id = ${store.id}::uuid and (r.created_at at time zone s.time_zone)::date >= ${p.from}::date
            and (r.created_at at time zone s.time_zone)::date < ${p.to}::date) as returns_requested,
        (select count(*)::int from commerce.returns r
          where r.store_id = ${store.id}::uuid and r.status::text not in ('closed', 'declined', 'cancelled')) as open_returns,
        (select count(*)::int from commerce.orders o
          where o.store_id = ${store.id}::uuid and o.copied_from is null and o.archived_at is null
            and o.status = 'paid' and ${PHYSICAL_SQL} and o.delivery_method = 'ship') as to_send,
        (select count(*)::int from commerce.stock_alerts a where a.store_id = ${store.id}::uuid and a.state = 'low') as low_stock,
        (select d.mode from commerce.support_settings d where d.store_id = ${store.id}::uuid) as desk_mode,
        (select count(*)::int from commerce.support_conversations c
          where c.store_id = ${store.id}::uuid and c.status = 'open' and c.handler = 'queue') as support_waiting
    `),
  ]);
  const deskOn = counts?.desk_mode && counts.desk_mode !== "off";
  return {
    from: period.from,
    to: period.to,
    orders: totals.totals.orders,
    netSalesMinor: totals.totals.revenueMinor - totals.totals.refundsMinor,
    refundsMinor: totals.totals.refundsMinor,
    currency: mainCurrency(store),
    unconverted: totals.unconverted,
    missingCurrencies: totals.missingCurrencies,
    returnsRequested: Number(counts?.returns_requested ?? 0),
    openReturns: Number(counts?.open_returns ?? 0),
    toSend: Number(counts?.to_send ?? 0),
    lowStock: Number(counts?.low_stock ?? 0),
    supportWaiting: deskOn ? Number(counts?.support_waiting ?? 0) : null,
    before:
      totals.unconverted > 0 || previous.unconverted > 0
        ? null
        : { orders: previous.totals.orders, netSalesMinor: previous.totals.revenueMinor - previous.totals.refundsMinor },
  };
}
