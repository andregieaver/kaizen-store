import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { isPayoutStatus, payoutReportOf, type PayoutInput, type PayoutLineFacts, type PayoutLineKind, type PayoutReport } from "@/lib/payouts";

import { toMainOne } from "./analytics-sql";
import { uuidList } from "./sql-arrays";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The Payouts page's reads (wave 4 unit C, D290): a store's payouts arriving in a period (by the day Stripe said they reach the bank, else the day
 * Stripe made them), with their lines, reconciled by `payoutReportOf()`; and one payout's lines with the orders they settle. Stored rows only, no
 * Stripe call. Every query takes the store id.
 */
export async function payoutsReport(store: Store, period: AnalyticsPeriod): Promise<PayoutReport> {
  const rows = await db().execute<Row>(sql`
    select p.id, p.provider_reference, p.arrival_on::text as arrival_on, p.status, p.amount_minor, p.currency, p.test_mode, p.automatic,
      p.lines_read_at is not null as lines_read, p.lines_complete
      from commerce.payouts p
     where p.store_id = ${store.id}::uuid
       and coalesce(p.arrival_on, (p.provider_created_at at time zone ${store.timeZone})::date) >= ${period.from}::date
       and coalesce(p.arrival_on, (p.provider_created_at at time zone ${store.timeZone})::date) < ${period.to}::date
     order by coalesce(p.arrival_on, (p.provider_created_at at time zone ${store.timeZone})::date) desc, p.provider_created_at desc
     limit 500
  `);
  const ids = rows.map((r) => String(r.id));
  const lines = ids.length
    ? await db().execute<Row>(sql`
        select payout_id, kind, amount_minor, fee_minor, net_minor, order_id from commerce.payout_lines
         where store_id = ${store.id}::uuid and payout_id = any(${uuidList(ids)})
      `)
    : [];
  const byPayout = new Map<string, PayoutLineFacts[]>();
  for (const l of lines) {
    const list = byPayout.get(String(l.payout_id)) ?? [];
    list.push({ kind: String(l.kind) as PayoutLineKind, amountMinor: Number(l.amount_minor), feeMinor: Number(l.fee_minor), netMinor: Number(l.net_minor), orderId: l.order_id ? String(l.order_id) : null });
    byPayout.set(String(l.payout_id), list);
  }
  const inputs: PayoutInput[] = rows.flatMap((r) =>
    isPayoutStatus(r.status)
      ? [
          {
            id: String(r.id),
            reference: String(r.provider_reference),
            arrivalOn: r.arrival_on ? String(r.arrival_on) : null,
            status: r.status,
            amountMinor: Number(r.amount_minor),
            currency: String(r.currency).trim(),
            testMode: Boolean(r.test_mode),
            automatic: Boolean(r.automatic),
            linesRead: Boolean(r.lines_read),
            linesComplete: Boolean(r.lines_complete),
            lines: byPayout.get(String(r.id)) ?? [],
          },
        ]
      : [],
  );
  return payoutReportOf(inputs, (currency, minor) => toMainOne(store, currency, minor));
}

export type PayoutLineView = {
  id: string;
  kind: PayoutLineKind;
  providerType: string;
  sourceReference: string | null;
  amountMinor: number;
  feeMinor: number;
  netMinor: number;
  orderId: string | null;
  orderNumber: string | null;
  createdAt: string;
};

export type PayoutDetail = { payout: PayoutInput & { reference: string; failure: string | null }; lines: PayoutLineView[] };

/** One payout of the store's and its lines, newest first, with the number of the order each settles. Null when it is not this store's. */
export async function payoutDetail(store: Store, payoutId: string): Promise<PayoutDetail | null> {
  const [p] = await db().execute<Row>(sql`
    select id, provider_reference, arrival_on::text as arrival_on, status, amount_minor, currency, test_mode, automatic, lines_read_at is not null as lines_read, lines_complete,
      failure_message
      from commerce.payouts where store_id = ${store.id}::uuid and id = ${payoutId}::uuid
  `);
  if (!p || !isPayoutStatus(p.status)) return null;
  const rows = await db().execute<Row>(sql`
    select l.id, l.kind, l.provider_type, l.source_reference, l.amount_minor, l.fee_minor, l.net_minor, l.order_id, o.number, l.provider_created_at
      from commerce.payout_lines l
      left join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
     where l.store_id = ${store.id}::uuid and l.payout_id = ${payoutId}::uuid
     order by l.provider_created_at desc, l.provider_reference
  `);
  const lines: PayoutLineView[] = rows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind) as PayoutLineKind,
    providerType: String(r.provider_type),
    sourceReference: r.source_reference ? String(r.source_reference) : null,
    amountMinor: Number(r.amount_minor),
    feeMinor: Number(r.fee_minor),
    netMinor: Number(r.net_minor),
    orderId: r.order_id ? String(r.order_id) : null,
    orderNumber: r.number ? String(r.number) : null,
    createdAt: new Date(String(r.provider_created_at)).toISOString(),
  }));
  return {
    payout: {
      id: String(p.id),
      reference: String(p.provider_reference),
      arrivalOn: p.arrival_on ? String(p.arrival_on) : null,
      status: p.status,
      amountMinor: Number(p.amount_minor),
      currency: String(p.currency).trim(),
      testMode: Boolean(p.test_mode),
      automatic: Boolean(p.automatic),
      linesRead: Boolean(p.lines_read),
      linesComplete: Boolean(p.lines_complete),
      failure: p.failure_message ? String(p.failure_message) : null,
      lines: lines.map((l) => ({ kind: l.kind, amountMinor: l.amountMinor, feeMinor: l.feeMinor, netMinor: l.netMinor, orderId: l.orderId })),
    },
    lines,
  };
}
