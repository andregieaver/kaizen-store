import "server-only";

import { sql } from "drizzle-orm";

import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { paymentsByMethod, type PaymentGroupRow, type PaymentsByMethod } from "@/lib/analytics-payments";
import type { AnalyticsSettings } from "@/lib/analytics-kpi";

import { inPeriod, num, PAID, toMainOne, type Row } from "./analytics-sql";
import { setBasedReplica as setBased } from "./analytics-totals";
import type { Store } from "./stores";

/**
 * Payments by method for a period (wave 4 unit A, D288, docs/analytics.md "Payments by method"): the captured payments of the period's paid orders (`PAID`,
 * by the order's day, as revenue is), grouped by what the provider said they were, with the refunds made on them in the period (by the refund's own day,
 * as Finance counts refunds; an order change's refund is not one) and Stripe's fee estimated from Analytics settings. Amounts are with VAT, as the money
 * moved; the rows add up to the money received for the period's paid orders. Stripe test-mode payments count as the paid orders do (the store's own mode).
 */
export async function paymentMethodsReport(store: Store, period: AnalyticsPeriod, settings: Pick<AnalyticsSettings, "paymentFeeBps" | "paymentFeeFixedMinor">): Promise<PaymentsByMethod> {
  const id = store.id;
  const rows = await setBased<Row>(sql`
    with pay as (
      select p.id, p.provider, p.method_type, p.wallet, p.method, p.currency::text as currency, p.amount_minor,
        -- Stripe's own fee, where read in the payment's currency (D290); the others are estimated.
        case when p.provider_fee_minor is not null and p.fee_currency = p.currency then p.provider_fee_minor end as real_fee
        from commerce.payments p
        join commerce.orders o on o.store_id = p.store_id and o.id = p.order_id
       where p.store_id = ${id}::uuid and p.status = 'captured' and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)}
    ),
    refunded as (
      select r.payment_id, sum(r.amount_minor) as amount
        from commerce.refunds r
       where r.store_id = ${id}::uuid and r.status = 'succeeded' and r.order_edit_id is null and r.kind <> 'void' and ${inPeriod(store, sql`r.created_at`, period)}
         and r.payment_id in (select id from pay)
       group by 1
    )
    select pay.provider, pay.method_type, pay.wallet, pay.method, pay.currency, count(*) as payments, sum(pay.amount_minor) as received,
      coalesce(sum(refunded.amount), 0) as refunded,
      coalesce(sum(round(pay.amount_minor::numeric * ${settings.paymentFeeBps} / 10000)) filter (where pay.provider = 'stripe' and pay.real_fee is null), 0) as fee_share,
      count(*) filter (where pay.provider = 'stripe' and pay.real_fee is null) as fee_payments,
      coalesce(sum(pay.real_fee) filter (where pay.provider = 'stripe'), 0) as real_fee,
      count(*) filter (where pay.provider = 'stripe' and pay.real_fee is not null) as real_fee_payments
    from pay left join refunded on refunded.payment_id = pay.id
    group by 1, 2, 3, 4, 5
  `);
  const groups: PaymentGroupRow[] = rows.map((r) => ({
    provider: String(r.provider),
    methodType: r.method_type ? String(r.method_type) : null,
    wallet: r.wallet ? String(r.wallet) : null,
    manualMethod: r.method ? String(r.method) : null,
    currency: String(r.currency).trim(),
    payments: num(r, "payments"),
    receivedMinor: num(r, "received"),
    refundedMinor: num(r, "refunded"),
    feeShareMinor: num(r, "fee_share"),
    feePayments: num(r, "fee_payments"),
    realFeeMinor: num(r, "real_fee"),
    realFeePayments: num(r, "real_fee_payments"),
  }));
  return paymentsByMethod(groups, (currency, minor) => toMainOne(store, currency, minor), settings.paymentFeeFixedMinor);
}
