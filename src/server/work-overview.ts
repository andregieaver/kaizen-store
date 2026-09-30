import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { effectiveRate, type BillingType } from "@/lib/work-calc";
import { todayIn } from "@/lib/work-dates";
import {
  workOverview,
  type OverviewEntry,
  type OverviewInvoice,
  type OverviewTimer,
  type WorkOverview,
} from "@/lib/work-overview";
import { workBase } from "@/lib/work-paths";

type Row = Record<string, unknown>;

/**
 * What the Work overview page shows (docs/work.md 6.5): the figures from
 * `workOverview()` over plain rows, with the names the page needs to say whose
 * they are. Every query takes the store; nothing is written.
 */
export type WorkOverviewView = {
  overview: WorkOverview;
  today: string;
  /** Clients that are not archived: none means the store is at its very start. */
  clientCount: number;
  clientNames: Record<string, string>;
  /** Overdue invoices' printed numbers. */
  invoiceNumbers: Record<string, string>;
  /** Running timers: the assignment and its client, and who runs it. */
  assignmentNames: Record<string, { name: string; clientName: string }>;
  people: Record<string, string>;
};

const idList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
const unique = (ids: string[]) => [...new Set(ids)];

/**
 * The places attention items point to, as pages that exist: a new invoice is
 * made from the invoices list (a sheet), so "invoice time" opens it.
 */
export function attentionHref(href: string, base: string): string {
  return href === `${base}/invoices/new` ? `${base}/invoices` : href;
}

export async function getWorkOverview(store: {
  id: string;
  slug: string;
  timeZone: string;
}): Promise<WorkOverviewView> {
  const storeId = store.id;
  const base = workBase(store.slug);
  const today = todayIn(store.timeZone);

  const [invoiceRows, entryRows, timerRows, clientCountRows] = await Promise.all([
    db().execute<Row>(sql`
      select i.id, i.client_id, i.status, i.currency, i.total_minor, i.due_on::text as due_on, i.recurring_period::text as recurring_period,
             (i.paid_at at time zone ${store.timeZone})::date::text as paid_on,
             (i.updated_at at time zone ${store.timeZone})::date::text as updated_on,
             coalesce((select sum(p.amount_minor) from commerce.work_invoice_payments p
                        where p.store_id = i.store_id and p.invoice_id = i.id), 0)::bigint as paid_minor,
             coalesce((select sum(c.total_minor) from commerce.work_credit_notes c
                        where c.store_id = i.store_id and c.invoice_id = i.id), 0)::bigint as credited_minor
      from commerce.work_invoices i
      where i.store_id = ${storeId}::uuid
        and (i.status in ('draft', 'sent') or (i.status = 'paid' and i.paid_at >= now() - interval '40 days'))
    `),
    db().execute<Row>(sql`
      select e.assignment_id, a.client_id, a.billing_type, a.hourly_rate_minor, c.default_hourly_rate_minor, c.currency,
             e.work_date::text as work_date, e.minutes, e.billable, e.prepaid_minutes, e.invoice_line_id
      from commerce.work_time_entries e
      join commerce.work_assignments a on a.store_id = e.store_id and a.id = e.assignment_id
      join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
      where e.store_id = ${storeId}::uuid and e.billable and e.invoice_line_id is null and a.billing_type = 'hourly'
    `),
    db().execute<Row>(sql`
      select account_id, assignment_id, (extract(epoch from started_at) * 1000)::bigint as started_ms
      from commerce.work_timers where store_id = ${storeId}::uuid
    `),
    db().execute<Row>(sql`
      select count(*)::int as n from commerce.work_clients where store_id = ${storeId}::uuid and archived_at is null
    `),
  ]);

  const invoices: OverviewInvoice[] = invoiceRows.map((r) => ({
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
  const entries: OverviewEntry[] = entryRows.map((r) => {
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
  const timers: OverviewTimer[] = timerRows.map((r) => ({
    accountId: String(r.account_id),
    assignmentId: String(r.assignment_id),
    startedAt: Number(r.started_ms),
  }));

  const overview = workOverview({ today, now: Date.now(), invoices, entries, timers, base });
  overview.attention = overview.attention.map((item) => ({ ...item, href: attentionHref(item.href, base) }));

  // The names the page needs, only for what it shows.
  const clientIds = unique([
    ...overview.unbilledByClient.map((c) => c.clientId),
    ...overview.overdueInvoices.map((i) => i.clientId),
  ]);
  const overdueIds = overview.overdueInvoices.map((i) => i.invoiceId);
  const assignmentIds = unique(overview.runningTimers.map((t) => t.assignmentId));
  const accountIds = unique(overview.runningTimers.map((t) => t.accountId));
  const [clientRows, numberRows, assignmentRows, personRows] = await Promise.all([
    clientIds.length === 0
      ? []
      : db().execute<Row>(sql`
          select id, name from commerce.work_clients where store_id = ${storeId}::uuid and id in (${idList(clientIds)})
        `),
    overdueIds.length === 0
      ? []
      : db().execute<Row>(sql`
          select id, document_number from commerce.work_invoices where store_id = ${storeId}::uuid and id in (${idList(overdueIds)})
        `),
    assignmentIds.length === 0
      ? []
      : db().execute<Row>(sql`
          select a.id, a.name, c.name as client_name
          from commerce.work_assignments a join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
          where a.store_id = ${storeId}::uuid and a.id in (${idList(assignmentIds)})
        `),
    accountIds.length === 0
      ? []
      : db().execute<Row>(sql`
          select id, coalesce(nullif(name, ''), email) as label from commerce.accounts where id in (${idList(accountIds)})
        `),
  ]);

  return {
    overview,
    today,
    clientCount: Number(clientCountRows[0]?.n ?? 0),
    clientNames: Object.fromEntries(clientRows.map((r) => [String(r.id), String(r.name)])),
    invoiceNumbers: Object.fromEntries(numberRows.map((r) => [String(r.id), String(r.document_number ?? "")])),
    assignmentNames: Object.fromEntries(
      assignmentRows.map((r) => [String(r.id), { name: String(r.name), clientName: String(r.client_name) }]),
    ),
    people: Object.fromEntries(personRows.map((r) => [String(r.id), String(r.label)])),
  };
}
