import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { isPayoutStatus, payoutReportOf, type PayoutInput, type PayoutLineFacts, type PayoutLineKind, type PayoutReport } from "@/lib/payouts";

import { toMainOne } from "./analytics-sql";
import { uuidList } from "./sql-arrays";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/** A payout as stored (CODE-02: money reads describe their rows). */
const payoutRow = z.object({
  id: col.uuid,
  provider_reference: col.text,
  arrival_on: col.textOrNull,
  status: col.text,
  amount_minor: col.minor,
  currency: col.currency,
  test_mode: col.bool,
  automatic: col.bool,
  lines_read: col.bool,
  lines_complete: col.bool,
});
const lineMoney = { kind: col.text, amount_minor: col.minor, fee_minor: col.minor, net_minor: col.minor, order_id: z.uuid().nullable() };

/**
 * The Payouts page's reads (wave 4 unit C, D290): a store's payouts arriving in a period (by the day Stripe said they reach the bank, else the day
 * Stripe made them), with their lines, reconciled by `payoutReportOf()`; and one payout's lines with the orders they settle. Stored rows only, no
 * Stripe call. Every query takes the store id.
 */
export async function payoutsReport(store: Store, period: AnalyticsPeriod): Promise<PayoutReport> {
  const rows = await typedRows(
    payoutRow,
    sql`
    select p.id, p.provider_reference, p.arrival_on::text as arrival_on, p.status, p.amount_minor, p.currency, p.test_mode, p.automatic,
      p.lines_read_at is not null as lines_read, p.lines_complete
      from commerce.payouts p
     where p.store_id = ${store.id}::uuid
       and coalesce(p.arrival_on, (p.provider_created_at at time zone ${store.timeZone})::date) >= ${period.from}::date
       and coalesce(p.arrival_on, (p.provider_created_at at time zone ${store.timeZone})::date) < ${period.to}::date
     order by coalesce(p.arrival_on, (p.provider_created_at at time zone ${store.timeZone})::date) desc, p.provider_created_at desc
     limit 500
  `,
  );
  const ids = rows.map((r) => r.id);
  const lines = ids.length
    ? await typedRows(
        z.object({ payout_id: col.uuid, ...lineMoney }),
        sql`
        select payout_id, kind, amount_minor, fee_minor, net_minor, order_id from commerce.payout_lines
         where store_id = ${store.id}::uuid and payout_id = any(${uuidList(ids)})
      `,
      )
    : [];
  const byPayout = new Map<string, PayoutLineFacts[]>();
  for (const l of lines) {
    const list = byPayout.get(l.payout_id) ?? [];
    list.push({ kind: l.kind as PayoutLineKind, amountMinor: l.amount_minor, feeMinor: l.fee_minor, netMinor: l.net_minor, orderId: l.order_id });
    byPayout.set(l.payout_id, list);
  }
  const inputs: PayoutInput[] = rows.flatMap((r) =>
    isPayoutStatus(r.status)
      ? [
          {
            id: r.id,
            reference: r.provider_reference,
            arrivalOn: r.arrival_on,
            status: r.status,
            amountMinor: r.amount_minor,
            currency: r.currency,
            testMode: r.test_mode,
            automatic: r.automatic,
            linesRead: r.lines_read,
            linesComplete: r.lines_complete,
            lines: byPayout.get(r.id) ?? [],
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
  const p = await typedRow(
    payoutRow.extend({ failure_message: col.textOrNull }),
    sql`
    select id, provider_reference, arrival_on::text as arrival_on, status, amount_minor, currency, test_mode, automatic, lines_read_at is not null as lines_read, lines_complete,
      failure_message
      from commerce.payouts where store_id = ${store.id}::uuid and id = ${payoutId}::uuid
  `,
  );
  if (!p) return null;
  const status = p.status;
  if (!isPayoutStatus(status)) return null;
  const rows = await typedRows(
    z.object({ id: col.uuid, provider_type: col.text, source_reference: col.textOrNull, number: col.textOrNull, provider_created_at: col.timestamp, ...lineMoney }),
    sql`
    select l.id, l.kind, l.provider_type, l.source_reference, l.amount_minor, l.fee_minor, l.net_minor, l.order_id, o.number, l.provider_created_at
      from commerce.payout_lines l
      left join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
     where l.store_id = ${store.id}::uuid and l.payout_id = ${payoutId}::uuid
     order by l.provider_created_at desc, l.provider_reference
  `,
  );
  const lines: PayoutLineView[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind as PayoutLineKind,
    providerType: r.provider_type,
    sourceReference: r.source_reference,
    amountMinor: r.amount_minor,
    feeMinor: r.fee_minor,
    netMinor: r.net_minor,
    orderId: r.order_id,
    orderNumber: r.number,
    createdAt: r.provider_created_at,
  }));
  return {
    payout: {
      id: p.id,
      reference: p.provider_reference,
      arrivalOn: p.arrival_on,
      status,
      amountMinor: p.amount_minor,
      currency: p.currency,
      testMode: p.test_mode,
      automatic: p.automatic,
      linesRead: p.lines_read,
      linesComplete: p.lines_complete,
      failure: p.failure_message,
      lines: lines.map((l) => ({ kind: l.kind, amountMinor: l.amountMinor, feeMinor: l.feeMinor, netMinor: l.netMinor, orderId: l.orderId })),
    },
    lines,
  };
}
