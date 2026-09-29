import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { readDb } from "@/db/client";
import { mainCurrency } from "@/lib/markets";
import type { BillingType } from "@/lib/work-calc";
import { buildWorkReport, type WorkReport } from "@/lib/work-csv";
import { isDay, type Day } from "@/lib/work-dates";
import {
  MAX_REPORT_DAYS,
  buildPeriodReport,
  type PeriodReport,
  type ReportAssignment,
  type ReportClient,
  type ReportCredit,
  type ReportDraft,
  type ReportEntry,
  type ReportGroupBy,
  type ReportInvoice,
  type ReportInvoiceLine,
} from "@/lib/work-reports";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * Work's reports (docs/work.md 1.9, 7.2 WP9): plain rows read for one store and one period, and the
 * pure `buildPeriodReport()` (`src/lib/work-reports.ts`) that decides what they mean. Every query takes
 * the store's id; nothing is written; nothing is added up in the browser. Days are the store's: issue
 * dates and work dates are days already, and a draft's day is worked out in the store's time zone.
 */

const uuid = z.uuid();
const num = (value: unknown): number => Number(value ?? 0);

/** What a report needs of the store: its id, its time zone, and its countries' currencies for an empty report. */
export type ReportStore = Pick<Store, "id" | "timeZone" | "markets">;

export type ReportArgs = {
  from: Day;
  to: Day;
  by: ReportGroupBy;
  /** One client's rows only. */
  clientId?: string | null;
};

function check(args: { from: Day; to: Day; clientId?: string | null }): string | null {
  if (!isDay(args.from) || !isDay(args.to)) throw new RangeError("A report needs a first and a last day");
  if (args.from > args.to) throw new RangeError("The first day is after the last day");
  const days = (Date.parse(`${args.to}T00:00:00Z`) - Date.parse(`${args.from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_REPORT_DAYS) throw new RangeError("A report can cover at most five years");
  if (args.clientId && !uuid.safeParse(args.clientId).success) throw new RangeError("Not a client");
  return args.clientId || null;
}

/** The report for a period: per client or per assignment, from the store's own rows. */
export async function getPeriodReport(store: ReportStore, args: ReportArgs): Promise<PeriodReport> {
  const clientId = check(args);
  const storeId = store.id;
  const { from, to } = args;
  // The column is always one of this file's own names, never input.
  const onlyClient = (column: string) => (clientId ? sql`and ${sql.raw(column)} = ${clientId}::uuid` : sql``);

  const [clientRows, assignmentRows, entryRows, invoiceRows, lineRows, creditRows, draftRows, draftLineRows] =
    await Promise.all([
      readDb().execute<Row>(sql`
        select id, name, currency, default_hourly_rate_minor
        from commerce.work_clients
        where store_id = ${storeId}::uuid ${onlyClient("id")}
      `),
      readDb().execute<Row>(sql`
        select id, client_id, name, billing_type, hourly_rate_minor
        from commerce.work_assignments
        where store_id = ${storeId}::uuid ${onlyClient("client_id")}
      `),
      readDb().execute<Row>(sql`
        select e.assignment_id, e.work_date::text as work_date, e.minutes, e.billable, e.prepaid_minutes, e.invoice_line_id
        from commerce.work_time_entries e
        join commerce.work_assignments a on a.store_id = e.store_id and a.id = e.assignment_id
        where e.store_id = ${storeId}::uuid and e.work_date between ${from}::date and ${to}::date
          ${onlyClient("a.client_id")}
      `),
      readDb().execute<Row>(sql`
        select i.id, i.client_id, i.currency, i.issued_on::text as issued_on,
               coalesce((select sum(p.amount_minor) from commerce.work_invoice_payments p
                          where p.store_id = i.store_id and p.invoice_id = i.id), 0)::bigint as paid_minor
        from commerce.work_invoices i
        where i.store_id = ${storeId}::uuid and i.status in ('sent', 'paid', 'void')
          and i.issued_on between ${from}::date and ${to}::date
          ${onlyClient("i.client_id")}
      `),
      readDb().execute<Row>(sql`
        select l.id, l.invoice_id, l.assignment_id, l.excl_minor, l.incl_minor
        from commerce.work_invoice_lines l
        join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id
        where l.store_id = ${storeId}::uuid and i.status in ('sent', 'paid', 'void')
          and i.issued_on between ${from}::date and ${to}::date
          ${onlyClient("i.client_id")}
      `),
      readDb().execute<Row>(sql`
        select c.invoice_id, (x.line ->> 'line_id')::uuid as line_id,
               (x.line ->> 'excl_minor')::bigint as excl_minor, (x.line ->> 'incl_minor')::bigint as incl_minor
        from commerce.work_credit_notes c
        join commerce.work_invoices i on i.store_id = c.store_id and i.id = c.invoice_id
        cross join lateral jsonb_array_elements(c.lines) as x(line)
        where c.store_id = ${storeId}::uuid and i.status in ('sent', 'paid', 'void')
          and i.issued_on between ${from}::date and ${to}::date
          ${onlyClient("i.client_id")}
      `),
      readDb().execute<Row>(sql`
        select i.id, i.client_id, i.currency, (i.created_at at time zone ${store.timeZone})::date::text as created_on
        from commerce.work_invoices i
        where i.store_id = ${storeId}::uuid and i.status = 'draft'
          and (i.created_at at time zone ${store.timeZone})::date between ${from}::date and ${to}::date
          ${onlyClient("i.client_id")}
      `),
      readDb().execute<Row>(sql`
        select l.invoice_id, l.assignment_id, l.excl_minor
        from commerce.work_invoice_lines l
        join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id
        where l.store_id = ${storeId}::uuid and i.status = 'draft'
          and (i.created_at at time zone ${store.timeZone})::date between ${from}::date and ${to}::date
          ${onlyClient("i.client_id")}
      `),
    ]);

  const clients: ReportClient[] = clientRows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    currency: String(r.currency),
    defaultHourlyRateMinor: r.default_hourly_rate_minor === null ? null : num(r.default_hourly_rate_minor),
  }));
  const assignments: ReportAssignment[] = assignmentRows.map((r) => ({
    id: String(r.id),
    clientId: String(r.client_id),
    name: String(r.name),
    billingType: r.billing_type as BillingType,
    hourlyRateMinor: r.hourly_rate_minor === null ? null : num(r.hourly_rate_minor),
  }));
  const entries: ReportEntry[] = entryRows.map((r) => ({
    assignmentId: String(r.assignment_id),
    workDate: String(r.work_date),
    minutes: num(r.minutes),
    billable: Boolean(r.billable),
    prepaidMinutes: num(r.prepaid_minutes),
    invoiceLineId: r.invoice_line_id ? String(r.invoice_line_id) : null,
  }));

  const linesOf = new Map<string, ReportInvoiceLine[]>();
  for (const r of lineRows) {
    const list = linesOf.get(String(r.invoice_id)) ?? [];
    list.push({
      lineId: String(r.id),
      assignmentId: r.assignment_id ? String(r.assignment_id) : null,
      exclMinor: num(r.excl_minor),
      inclMinor: num(r.incl_minor),
    });
    linesOf.set(String(r.invoice_id), list);
  }
  const creditsOf = new Map<string, ReportCredit[]>();
  for (const r of creditRows) {
    const list = creditsOf.get(String(r.invoice_id)) ?? [];
    list.push({ lineId: String(r.line_id), exclMinor: num(r.excl_minor), inclMinor: num(r.incl_minor) });
    creditsOf.set(String(r.invoice_id), list);
  }
  const invoices: ReportInvoice[] = invoiceRows.map((r) => ({
    id: String(r.id),
    clientId: String(r.client_id),
    currency: String(r.currency),
    issuedOn: String(r.issued_on),
    paidMinor: num(r.paid_minor),
    lines: linesOf.get(String(r.id)) ?? [],
    credits: creditsOf.get(String(r.id)) ?? [],
  }));

  const draftLinesOf = new Map<string, { assignmentId: string | null; exclMinor: number }[]>();
  for (const r of draftLineRows) {
    const list = draftLinesOf.get(String(r.invoice_id)) ?? [];
    list.push({ assignmentId: r.assignment_id ? String(r.assignment_id) : null, exclMinor: num(r.excl_minor) });
    draftLinesOf.set(String(r.invoice_id), list);
  }
  const drafts: ReportDraft[] = draftRows.map((r) => ({
    id: String(r.id),
    clientId: String(r.client_id),
    currency: String(r.currency),
    createdOn: String(r.created_on),
    lines: draftLinesOf.get(String(r.id)) ?? [],
  }));

  return buildPeriodReport({
    from,
    to,
    by: args.by,
    fallbackCurrency: mainCurrency(store),
    clients,
    assignments,
    entries,
    invoices,
    drafts,
  });
}

/**
 * One client's time in a period with every entry, per assignment (Life's client report and its CSV,
 * `buildWorkReport()`), where a fixed fee is counted once: only what issued invoices took for the
 * assignment in the period (less credit notes), never the whole fee in every period shown. Null when
 * the store has no such client.
 */
export async function clientTimeReport(
  storeId: string,
  clientId: string,
  period: { from: Day; to: Day },
): Promise<WorkReport | null> {
  if (!uuid.safeParse(clientId).success) return null;
  check({ ...period, clientId });
  const { from, to } = period;
  const [clientRows] = await Promise.all([
    readDb().execute<Row>(sql`
      select id, name, currency, default_hourly_rate_minor
      from commerce.work_clients where store_id = ${storeId}::uuid and id = ${clientId}::uuid
    `),
  ]);
  const client = clientRows[0];
  if (!client) return null;
  const [assignmentRows, entryRows, taskRows, feeRows] = await Promise.all([
    readDb().execute<Row>(sql`
      select id, name, billing_type, hourly_rate_minor, fixed_amount_minor
      from commerce.work_assignments where store_id = ${storeId}::uuid and client_id = ${clientId}::uuid
    `),
    readDb().execute<Row>(sql`
      select e.assignment_id, e.task_id, e.work_date::text as work_date, e.minutes, e.billable, e.note
      from commerce.work_time_entries e
      join commerce.work_assignments a on a.store_id = e.store_id and a.id = e.assignment_id
      where e.store_id = ${storeId}::uuid and a.client_id = ${clientId}::uuid
        and e.work_date between ${from}::date and ${to}::date
    `),
    readDb().execute<Row>(sql`
      select t.id, t.title
      from commerce.work_tasks t
      join commerce.work_assignments a on a.store_id = t.store_id and a.id = t.assignment_id
      where t.store_id = ${storeId}::uuid and a.client_id = ${clientId}::uuid
    `),
    // What issued invoices took for each assignment in the period, net of what credit notes gave back.
    readDb().execute<Row>(sql`
      select l.assignment_id,
             (coalesce(sum(l.excl_minor), 0) - coalesce(sum(cr.excl_minor), 0))::bigint as fee_minor
      from commerce.work_invoice_lines l
      join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id
      left join lateral (
        select coalesce(sum((x.line ->> 'excl_minor')::bigint), 0) as excl_minor
        from commerce.work_credit_notes c
        cross join lateral jsonb_array_elements(c.lines) as x(line)
        where c.store_id = l.store_id and c.invoice_id = l.invoice_id and (x.line ->> 'line_id')::uuid = l.id
      ) cr on true
      where l.store_id = ${storeId}::uuid and l.assignment_id is not null and i.client_id = ${clientId}::uuid
        and i.status in ('sent', 'paid', 'void') and i.issued_on between ${from}::date and ${to}::date
      group by l.assignment_id
    `),
  ]);
  const feeBy = new Map(feeRows.map((r) => [String(r.assignment_id), num(r.fee_minor)]));
  return buildWorkReport({
    client: {
      name: String(client.name),
      currency: String(client.currency),
      defaultHourlyRateMinor: client.default_hourly_rate_minor === null ? null : num(client.default_hourly_rate_minor),
    },
    periodStart: from,
    periodEnd: to,
    assignments: assignmentRows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      billingType: r.billing_type as BillingType,
      hourlyRateMinor: r.hourly_rate_minor === null ? null : num(r.hourly_rate_minor),
      fixedAmountMinor: r.fixed_amount_minor === null ? null : num(r.fixed_amount_minor),
      fixedFeeInPeriodMinor: feeBy.get(String(r.id)) ?? 0,
    })),
    entries: entryRows.map((r) => ({
      assignmentId: String(r.assignment_id),
      taskId: r.task_id ? String(r.task_id) : null,
      workDate: String(r.work_date),
      minutes: num(r.minutes),
      billable: Boolean(r.billable),
      note: r.note ? String(r.note) : null,
    })),
    taskTitles: new Map(taskRows.map((r) => [String(r.id), String(r.title)])),
  });
}
