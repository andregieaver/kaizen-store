import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { effectiveRate, type BillingType } from "@/lib/work-calc";
import { todayIn } from "@/lib/work-dates";
import {
  workOverview,
  type AttentionItem,
  type OverviewEntry,
  type OverviewInvoice,
  type OverviewTimer,
} from "@/lib/work-overview";

import { attentionHref } from "./work-overview";

type Row = Record<string, unknown>;

const idList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/**
 * What needs the owner in the Work area of several stores at once, for the control center (D107, docs/work.md
 * 6.5): the Work overview's own attention items (invoices overdue, recurring invoices ready, time unbilled
 * for over 30 days, drafts waiting, timers left running), worded by `workOverview()` with the store's name
 * in front and pointing at the store's Work pages. A handful of queries for all the stores together, never
 * one set per store; the rows are the ones `getWorkOverview()` reads, for many stores. Only stores with the
 * module on are asked about; the result has an entry (possibly empty) for each.
 */
export async function workAttention(
  stores: readonly { id: string; slug: string; name: string; timeZone: string }[],
  now = Date.now(),
): Promise<Map<string, AttentionItem[]>> {
  const result = new Map<string, AttentionItem[]>(stores.map((s) => [s.id, []]));
  if (stores.length === 0) return result;
  const ids = stores.map((s) => s.id);

  const [invoiceRows, entryRows, timerRows] = await Promise.all([
    db().execute<Row>(sql`
      select i.store_id, i.id, i.client_id, i.status, i.currency, i.total_minor, i.due_on::text as due_on,
             i.recurring_period::text as recurring_period,
             (i.paid_at at time zone s.time_zone)::date::text as paid_on,
             (i.updated_at at time zone s.time_zone)::date::text as updated_on,
             coalesce((select sum(p.amount_minor) from commerce.work_invoice_payments p
                        where p.store_id = i.store_id and p.invoice_id = i.id), 0)::bigint as paid_minor,
             coalesce((select sum(c.total_minor) from commerce.work_credit_notes c
                        where c.store_id = i.store_id and c.invoice_id = i.id), 0)::bigint as credited_minor
      from commerce.work_invoices i
      join commerce.stores s on s.id = i.store_id
      where i.store_id in (${idList(ids)})
        and (i.status in ('draft', 'sent') or (i.status = 'paid' and i.paid_at >= now() - interval '40 days'))
    `),
    db().execute<Row>(sql`
      select e.store_id, e.assignment_id, a.client_id, a.billing_type, a.hourly_rate_minor, c.default_hourly_rate_minor, c.currency,
             e.work_date::text as work_date, e.minutes, e.billable, e.prepaid_minutes, e.invoice_line_id
      from commerce.work_time_entries e
      join commerce.work_assignments a on a.store_id = e.store_id and a.id = e.assignment_id
      join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
      where e.store_id in (${idList(ids)}) and e.billable and e.invoice_line_id is null and a.billing_type = 'hourly'
    `),
    db().execute<Row>(sql`
      select store_id, account_id, assignment_id, (extract(epoch from started_at) * 1000)::bigint as started_ms
      from commerce.work_timers where store_id in (${idList(ids)})
    `),
  ]);

  const group = <T>(rows: readonly Row[], make: (r: Row) => T) => {
    const by = new Map<string, T[]>();
    for (const r of rows) {
      const list = by.get(String(r.store_id)) ?? [];
      list.push(make(r));
      by.set(String(r.store_id), list);
    }
    return by;
  };
  const invoices = group<OverviewInvoice>(invoiceRows, (r) => ({
    id: String(r.id),
    clientId: String(r.client_id),
    status: r.status as OverviewInvoice["status"],
    currency: String(r.currency),
    totalMinor: Number(r.total_minor),
    paidMinor: Number(r.paid_minor),
    creditedMinor: Number(r.credited_minor),
    dueOn: r.due_on ? String(r.due_on) : null,
    paidOn: r.paid_on ? String(r.paid_on) : null,
    updatedOn: String(r.updated_on),
    recurringPeriod: r.recurring_period ? String(r.recurring_period) : null,
  }));
  const entries = group<OverviewEntry>(entryRows, (r) => {
    const billingType = r.billing_type as BillingType;
    const { rateMinor } = effectiveRate(
      { billingType, hourlyRateMinor: r.hourly_rate_minor === null ? null : Number(r.hourly_rate_minor) },
      { defaultHourlyRateMinor: r.default_hourly_rate_minor === null ? null : Number(r.default_hourly_rate_minor) },
    );
    return {
      clientId: String(r.client_id),
      assignmentId: String(r.assignment_id),
      billingType,
      currency: String(r.currency),
      rateMinor,
      workDate: String(r.work_date),
      minutes: Number(r.minutes),
      billable: Boolean(r.billable),
      prepaidMinutes: Number(r.prepaid_minutes),
      invoiceLineId: r.invoice_line_id ? String(r.invoice_line_id) : null,
    };
  });
  const timers = group<OverviewTimer>(timerRows, (r) => ({
    accountId: String(r.account_id),
    assignmentId: String(r.assignment_id),
    startedAt: Number(r.started_ms),
  }));

  for (const store of stores) {
    const base = `/admin/${store.slug}/work`;
    const overview = workOverview({
      today: todayIn(store.timeZone, now),
      now,
      invoices: invoices.get(store.id) ?? [],
      entries: entries.get(store.id) ?? [],
      timers: timers.get(store.id) ?? [],
      base,
      label: store.name,
    });
    result.set(
      store.id,
      overview.attention.map((item) => ({ ...item, href: attentionHref(item.href, base) })),
    );
  }
  return result;
}
