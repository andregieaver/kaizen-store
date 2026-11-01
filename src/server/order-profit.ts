import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { conversionFactor } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";
import { orderProfit, type OrderProfit, type OrderProfitInput } from "@/lib/order-profit";

import { getAnalyticsSettings } from "./analytics-settings";
import { setBasedReplica } from "./analytics-totals";
import { GIFT_CARD_LINE, NOT_EDIT_REFUND, PAID, SOLD_AT, soldIn } from "./analytics-sql";
import type { Store } from "./stores";
import { checkedRows, col } from "./typed-rows";

/**
 * Profit per order (D415, `src/lib/order-profit.ts`): one paid order's figures read as the Finance page reads them (gift card lines left out,
 * refunds that settle an order change left out, Stripe test-mode disputes left out), and a period's paid orders the same way. Copied and
 * hosts' orders are no sale (`PAID`), so they have no profit. Read on the replica, as the analytics pages are.
 */

const LINE = z.object({ q: z.number(), c: z.number().nullable(), n: z.boolean() });
const PAYMENT = z.object({ p: z.string(), a: z.number(), k: z.number().nullable(), f: z.number().nullable(), fc: z.string().nullable() });
const DISPUTE = z.object({ a: z.number(), f: z.number().nullable(), c: z.string() });

const ROW = z.object({
  id: col.uuid,
  number: col.text,
  currency: col.currency,
  total_minor: col.minor,
  tax_minor: col.minor,
  sold_at: col.timestamp,
  voucher: col.minor,
  refunds: col.minor,
  physical: col.bool,
  lines: z.array(LINE),
  payments: z.array(PAYMENT),
  parcels: z.array(z.number().nullable()),
  disputes: z.array(DISPUTE),
});

function profitQuery(store: Store, where: SQL): SQL {
  return sql`
    select o.id, o.number, o.currency, o.total_minor, o.tax_minor, ${SOLD_AT} as sold_at,
      coalesce((select sum(ol.total_minor - ol.tax_minor) from commerce.order_lines ol where ol.store_id = o.store_id and ol.order_id = o.id and ${GIFT_CARD_LINE}), 0) as voucher,
      coalesce((select sum(r.amount_minor) from commerce.refunds r join commerce.payments rp on rp.store_id = r.store_id and rp.id = r.payment_id
        where r.store_id = o.store_id and rp.order_id = o.id and r.status = 'succeeded' and ${NOT_EDIT_REFUND}), 0) as refunds,
      exists (select 1 from commerce.order_lines ol where ol.store_id = o.store_id and ol.order_id = o.id and ol.delivery = 'physical') as physical,
      coalesce((select jsonb_agg(jsonb_build_object('q', ol.quantity, 'c', ol.unit_cost_minor, 'n', (ol.variant_id is not null or ol.custom)))
        from commerce.order_lines ol where ol.store_id = o.store_id and ol.order_id = o.id and not ${GIFT_CARD_LINE}), '[]'::jsonb) as lines,
      coalesce((select jsonb_agg(jsonb_build_object('p', p.provider, 'a', p.amount_minor, 'k', p.kaizen_fee_minor, 'f', p.provider_fee_minor, 'fc', p.fee_currency))
        from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured'), '[]'::jsonb) as payments,
      coalesce((select jsonb_agg(sh.label_cost_minor) from commerce.shipments sh
        where sh.store_id = o.store_id and sh.order_id = o.id and sh.method = 'parcel' and sh.undone_at is null), '[]'::jsonb) as parcels,
      coalesce((select jsonb_agg(jsonb_build_object('a', d.amount_minor, 'f', d.fee_minor, 'c', d.currency))
        from commerce.payment_disputes d where d.store_id = o.store_id and d.order_id = o.id and d.outcome = 'lost' and not d.test_mode), '[]'::jsonb) as disputes
    from commerce.orders o
    where o.store_id = ${store.id}::uuid and ${PAID} and ${where}
  `;
}

function inputOf(row: z.infer<typeof ROW>): OrderProfitInput {
  return {
    currency: row.currency,
    totalMinor: row.total_minor,
    taxMinor: row.tax_minor,
    voucherMinor: row.voucher,
    refundsMinor: row.refunds,
    lines: row.lines.map((l) => ({ quantity: l.q, unitCostMinor: l.c, needsCost: l.n })),
    payments: row.payments.map((p) => ({ provider: p.p, amountMinor: p.a, kaizenFeeMinor: p.k ?? 0, providerFeeMinor: p.f, feeCurrency: p.fc })),
    physical: row.physical,
    parcels: row.parcels,
    lostDisputes: row.disputes.map((d) => ({ amountMinor: d.a, feeMinor: d.f, feeCurrency: d.c })),
  };
}

const mainOf = (store: Store) => ({ currency: mainCurrency(store), rates: store.localization.rates });

/** One order's profit; null when it is no paid order of the store (unpaid, cancelled before payment, copied or a host's). */
export async function orderProfitFor(store: Store, orderId: string): Promise<OrderProfit | null> {
  if (!z.uuid().safeParse(orderId).success) return null;
  const [rows, settings] = await Promise.all([setBasedReplica(profitQuery(store, sql`o.id = ${orderId}::uuid`)).then((r) => checkedRows(ROW, r)), getAnalyticsSettings(store.id)]);
  return rows[0] ? orderProfit(inputOf(rows[0]), settings, mainOf(store)) : null;
}

export type OrderProfitRow = { id: string; number: string; soldAt: string; profit: OrderProfit };

/** At most this many of a period's orders are read for the table; past it the page says the period is too long to list. */
export const PROFIT_ORDERS_MAX = 5_000;

/** A period's paid orders (by the day they were sold, as the Finance page counts them), newest first, each with its profit. */
export async function periodOrderProfits(store: Store, period: Pick<AnalyticsPeriod, "from" | "to">): Promise<{ rows: OrderProfitRow[]; capped: boolean }> {
  const [rows, settings] = await Promise.all([
    setBasedReplica(sql`${profitQuery(store, soldIn(store, period))} order by ${SOLD_AT} desc limit ${PROFIT_ORDERS_MAX + 1}`).then((r) => checkedRows(ROW, r)),
    getAnalyticsSettings(store.id),
  ]);
  const main = mainOf(store);
  return {
    rows: rows.slice(0, PROFIT_ORDERS_MAX).map((row) => ({ id: row.id, number: row.number, soldAt: row.sold_at, profit: orderProfit(inputOf(row), settings, main) })),
    capped: rows.length > PROFIT_ORDERS_MAX,
  };
}

export type ProfitSummary = {
  orders: number;
  /** Orders with a figure, and the sum and average of their profit in the main currency (orders in a currency with no rate left out). */
  known: number;
  totalMinor: number;
  averageMinor: number | null;
  losses: number;
  /** Orders with no figure: a goods line without a cost, or no rate. */
  unknown: number;
  currency: string;
};

/** What the period's orders came to, in the store's main currency. */
export function profitSummary(store: Store, rows: readonly OrderProfitRow[]): ProfitSummary {
  const main = mainCurrency(store);
  let known = 0;
  let total = 0;
  let losses = 0;
  let unknown = 0;
  for (const row of rows) {
    const p = row.profit;
    if (p.profitMinor === null) {
      unknown++;
      continue;
    }
    const c = conversionFactor(p.currency, main, store.localization.rates);
    if (!c) {
      unknown++;
      continue;
    }
    known++;
    total += Math.round(p.profitMinor * c.factor);
    if (p.profitMinor < 0) losses++;
  }
  return { orders: rows.length, known, totalMinor: total, averageMinor: known > 0 ? Math.round(total / known) : null, losses, unknown, currency: main };
}
