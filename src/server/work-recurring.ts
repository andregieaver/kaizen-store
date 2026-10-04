import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, readDb, type Db } from "@/db/client";
import { lineDescription } from "@/lib/work-calc";
import { addCalendarDays, isDay, todayIn, type Day } from "@/lib/work-dates";
import { recurringInvoiceInput } from "@/lib/work-input";
import {
  duePeriods,
  isOccurrenceDay,
  nextOccurrences,
  openPeriods,
  planRecurring,
  recurrenceWindow,
  type ExistingInstance,
  type RecurringTemplate,
} from "@/lib/work-recurrence";
import { servicePeriod } from "@/lib/work-recurring-ui";

import type { Membership } from "./auth";
import { workEvent } from "./work";
import { refreshDraftInvoices } from "./work-draft-sync";
import { problem, workGuard, zodProblems, type WorkResult } from "./work-errors";
import { sendInvoiceEmail } from "./work-emails";
import { deleteDraft, issueInvoice, type WorkActor } from "./work-invoices";
import { memberCan } from "./permissions";

type Row = Record<string, unknown>;

/**
 * Recurring invoices (docs/work.md 1.6, 4.2, 7.2 WP8): templates a client is
 * billed by on a schedule, and the job that makes their invoices.
 *
 * What is decided is in `lib/work-recurrence.ts` (which periods are due, which
 * still need a draft, which drafts to issue, all in the store's own calendar);
 * this module carries it out. Nothing here runs while a page renders or from
 * a browser's trigger: the five-minute job calls `prepareDueRecurringWork()`,
 * and a person acts through "Generate now", "Skip this period" and "Issue now".
 *
 *  - A period's invoice is a draft with one line from the template
 *    (`recurring_invoice_id` + `recurring_period`, unique per store), so
 *    generating is idempotent however many runs overlap: the template row is
 *    locked, and the insert does nothing when the period already has one.
 *  - The job generates a period only while it is at most 40 days old, never one
 *    the owner skipped, and issues (numbers, freezes, snapshots: only through
 *    `issueInvoice`) and emails only the templates with `auto_issue`, which is
 *    off unless an owner switches it on. A draft the job cannot issue (the
 *    client's details are missing, say) stays a draft, and the reason is kept
 *    in the template's history, at most once a day.
 *  - Email is sent after issuing, apart from it: a mail that fails never undoes
 *    an issued invoice, is recorded, and is not tried again by the job (the
 *    invoice's own page offers "Send again").
 *  - A draft deleted by a person skips its period for good (a trigger writes
 *    `skipped_periods`, so it holds however the draft was deleted).
 *
 * Every query takes a store id. Money is integer minor units; the amounts of
 * a draft are worked out by the invoice module, never here.
 */

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const int = (value: unknown): number => Number(value ?? 0);
const intOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;

const ENTITY = "recurring_invoice";

/** The most a run of the job makes in one store, so a store with a great many templates cannot hold the job. */
const MAX_TEMPLATES_PER_STORE = 500;

// --- Shapes ------------------------------------------------------------------------------------------------

export type RecurringInvoice = {
  id: string;
  clientId: string;
  name: string;
  /** The text of the invoice's line. */
  description: string;
  unit: "hour" | "unit";
  quantityHundredths: number;
  /** Net of VAT, in the template's currency. */
  unitPriceMinor: number;
  discountBp: number;
  vatCategory: string;
  currency: string;
  recurrenceInterval: 1 | 2 | 3 | 4;
  recurrencePeriod: "week" | "month" | "year";
  startDate: Day;
  endDate: Day | null;
  paymentDays: number | null;
  autoIssue: boolean;
  isActive: boolean;
  skippedPeriods: Day[];
  sortOrder: number;
};

/** What the client's page shows of a template: the template and where its schedule stands today. */
export type RecurringSummary = RecurringInvoice & {
  /** The next periods after today, up to the end date. */
  next: Day[];
  /** Due periods that have no invoice, or only a draft, oldest first (what "Generate now" and "Issue now" act on). */
  open: { period: Day; invoiceId: string | null; overdueForJob: boolean }[];
  /** Its most recent invoice, whatever its status. */
  last: { invoiceId: string; period: Day; status: string; documentNumber: string | null } | null;
  invoiceCount: number;
};

export type RecurringList = { today: Day; templates: RecurringSummary[] };

const toTemplate = (r: Row): RecurringInvoice => ({
  id: String(r.id),
  clientId: String(r.client_id),
  name: String(r.name),
  description: String(r.description),
  unit: String(r.unit) as "hour" | "unit",
  quantityHundredths: int(r.quantity_hundredths),
  unitPriceMinor: int(r.unit_price_minor),
  discountBp: int(r.discount_bp),
  vatCategory: String(r.vat_category),
  currency: String(r.currency).trim(),
  recurrenceInterval: int(r.recurrence_interval) as 1 | 2 | 3 | 4,
  recurrencePeriod: String(r.recurrence_period) as "week" | "month" | "year",
  startDate: String(r.start_date),
  endDate: text(r.end_date),
  paymentDays: intOrNull(r.payment_days),
  autoIssue: Boolean(r.auto_issue),
  isActive: Boolean(r.is_active),
  skippedPeriods: ((r.skipped_periods as string[] | null) ?? []).map(String),
  sortOrder: int(r.sort_order),
});

const COLUMNS = sql`
  id, client_id, name, description, unit, quantity_hundredths, unit_price_minor, discount_bp, vat_category,
  currency::text as currency, recurrence_interval, recurrence_period, start_date::text as start_date,
  end_date::text as end_date, payment_days, auto_issue, is_active, skipped_periods::text[] as skipped_periods, sort_order
`;

/** What the plan needs of a template. */
export const planningView = (t: RecurringInvoice): RecurringTemplate => ({
  id: t.id,
  isActive: t.isActive,
  autoIssue: t.autoIssue,
  rule: { interval: t.recurrenceInterval, period: t.recurrencePeriod, startDate: t.startDate },
  endDate: t.endDate,
  skippedPeriods: t.skippedPeriods,
});

/** Today in the store's own time zone (`stores.time_zone`). */
async function storeToday(run: Pick<Db, "execute">, storeId: string): Promise<Day> {
  const [row] = await run.execute<Row>(sql`select commerce.work_today(${storeId}::uuid)::text as today`);
  return String(row.today);
}

// --- Reading -----------------------------------------------------------------------------------------------

/** Every instance of the given templates that falls in or after the window, newest last (for the plan and the panel). */
async function instancesOf(
  run: Pick<Db, "execute">,
  storeId: string,
  templateIds: readonly string[],
  from: Day,
): Promise<(ExistingInstance & { documentNumber: string | null })[]> {
  if (templateIds.length === 0) return [];
  const rows = await run.execute<Row>(sql`
    select id, recurring_invoice_id, recurring_period::text as period, status, document_number
    from commerce.work_invoices
    where store_id = ${storeId}::uuid and recurring_period >= ${from}::date
      and recurring_invoice_id in (select jsonb_array_elements_text(${JSON.stringify(templateIds)}::jsonb)::uuid)
    order by recurring_period, created_at
  `);
  return rows.map((r) => ({
    templateId: String(r.recurring_invoice_id),
    period: String(r.period),
    status: String(r.status) as ExistingInstance["status"],
    invoiceId: String(r.id),
    documentNumber: text(r.document_number),
  }));
}

/** A client's templates, with where each one's schedule stands, for the client's page. Nothing is written. */
export async function listRecurring(storeId: string, clientId: string): Promise<RecurringList> {
  if (!isUuid(clientId)) return { today: "", templates: [] };
  const run = readDb();
  const today = await storeToday(run, storeId);
  const rows = await run.execute<Row>(sql`
    select ${COLUMNS} from commerce.work_recurring_invoices
    where store_id = ${storeId}::uuid and client_id = ${clientId}::uuid
    order by is_active desc, sort_order, name, id
  `);
  const templates = rows.map(toTemplate);
  const window = recurrenceWindow(today);
  const instances = await instancesOf(
    run,
    storeId,
    templates.map((t) => t.id),
    window.from,
  );
  const counts = await run.execute<Row>(sql`
    select recurring_invoice_id, count(*)::int as n from commerce.work_invoices
    where store_id = ${storeId}::uuid and client_id = ${clientId}::uuid and recurring_invoice_id is not null
    group by recurring_invoice_id
  `);
  const countOf = new Map(counts.map((r) => [String(r.recurring_invoice_id), int(r.n)]));
  const latest = await run.execute<Row>(sql`
    select distinct on (recurring_invoice_id) recurring_invoice_id, id, recurring_period::text as period, status, document_number
    from commerce.work_invoices
    where store_id = ${storeId}::uuid and client_id = ${clientId}::uuid and recurring_invoice_id is not null
    order by recurring_invoice_id, recurring_period desc
  `);
  const lastOf = new Map(latest.map((r) => [String(r.recurring_invoice_id), r]));
  const cutoff = addCalendarDays(today, -40);

  return {
    today,
    templates: templates.map((t) => {
      const view = planningView(t);
      const last = lastOf.get(t.id);
      return {
        ...t,
        next: nextOccurrences(view.rule, today, 2, t.endDate),
        open: openPeriods(view, instances, today).map((o) => ({ ...o, overdueForJob: o.invoiceId === null && o.period < cutoff })),
        last: last
          ? { invoiceId: String(last.id), period: String(last.period), status: String(last.status), documentNumber: text(last.document_number) }
          : null,
        invoiceCount: countOf.get(t.id) ?? 0,
      };
    }),
  };
}

// --- Writing templates ---------------------------------------------------------------------------------------

type Created = WorkResult<{ id: string }>;

const NOT_FOUND = "This repeating invoice no longer exists.";
const OWNER_ONLY_AUTO = "Only an owner can switch automatic issuing on or off.";

/** A new template for one of the store's clients. Automatic issuing (off unless asked) is an owner's to switch on. */
export async function createRecurring(member: Membership, raw: unknown): Promise<Created> {
  const storeId = member.store.id;
  const parsed = recurringInvoiceInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  if (input.autoIssue && !memberCan(member, "owner")) return problem(OWNER_ONLY_AUTO);
  return workGuard(() =>
    db().transaction(async (tx): Promise<Created> => {
      const [client] = await tx.execute<Row>(sql`
        select archived_at from commerce.work_clients where store_id = ${storeId}::uuid and id = ${input.clientId}::uuid
      `);
      if (!client) return problem("This client no longer exists.");
      if (client.archived_at) return problem("This client is archived. Restore it before adding a repeating invoice.");
      const [order] = await tx.execute<Row>(sql`
        select coalesce(max(sort_order) + 1, 0)::int as next from commerce.work_recurring_invoices
        where store_id = ${storeId}::uuid and client_id = ${input.clientId}::uuid
      `);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.work_recurring_invoices
          (store_id, client_id, name, description, unit, quantity_hundredths, unit_price_minor, discount_bp, vat_category, currency,
           recurrence_interval, recurrence_period, start_date, end_date, payment_days, auto_issue, is_active, sort_order)
        values (${storeId}::uuid, ${input.clientId}::uuid, ${input.name}, ${lineDescription(input.description ?? input.name)},
                ${input.unit}, ${input.quantityHundredths}, ${input.unitPriceMinor}, ${input.discountBp}, ${input.vatCategory},
                ${input.currency}, ${input.recurrenceInterval}, ${input.recurrencePeriod}, ${input.startDate}::date,
                ${input.endDate}::date, ${input.paymentDays}, ${input.autoIssue}, ${input.isActive}, ${int(order.next)})
        returning id
      `);
      const id = String(row.id);
      await workEvent(
        tx,
        storeId,
        ENTITY,
        id,
        "recurring.created",
        { client_id: input.clientId, name: input.name, auto_issue: input.autoIssue },
        member.account.id,
      );
      return { ok: true, id };
    }),
  );
}

/**
 * Changes a template (its client never changes). What it already made is left as it is; a new
 * schedule counts from the start date again. Automatic issuing is an owner's to change.
 */
export async function updateRecurring(member: Membership, templateId: string, raw: unknown): Promise<Created> {
  const storeId = member.store.id;
  if (!isUuid(templateId)) return problem(NOT_FOUND);
  const parsed = recurringInvoiceInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  return workGuard(() =>
    db().transaction(async (tx): Promise<Created> => {
      const [current] = await tx.execute<Row>(sql`
        select client_id, auto_issue from commerce.work_recurring_invoices
        where store_id = ${storeId}::uuid and id = ${templateId}::uuid for update
      `);
      if (!current) return problem(NOT_FOUND);
      if (String(current.client_id) !== input.clientId) return problem("A repeating invoice stays with its client.");
      if (Boolean(current.auto_issue) !== input.autoIssue && !memberCan(member, "owner")) return problem(OWNER_ONLY_AUTO);
      await tx.execute(sql`
        update commerce.work_recurring_invoices
           set name = ${input.name}, description = ${lineDescription(input.description ?? input.name)}, unit = ${input.unit},
               quantity_hundredths = ${input.quantityHundredths}, unit_price_minor = ${input.unitPriceMinor},
               discount_bp = ${input.discountBp}, vat_category = ${input.vatCategory}, currency = ${input.currency},
               recurrence_interval = ${input.recurrenceInterval}, recurrence_period = ${input.recurrencePeriod},
               start_date = ${input.startDate}::date, end_date = ${input.endDate}::date, payment_days = ${input.paymentDays},
               auto_issue = ${input.autoIssue}, is_active = ${input.isActive}, updated_at = now()
         where store_id = ${storeId}::uuid and id = ${templateId}::uuid
      `);
      await workEvent(
        tx,
        storeId,
        ENTITY,
        templateId,
        "recurring.updated",
        { name: input.name, auto_issue: input.autoIssue, is_active: input.isActive },
        member.account.id,
      );
      return { ok: true, id: templateId };
    }),
  );
}

/** Pauses a template (no invoices are made, none are lost) or starts it again. Periods missed meanwhile follow the 40-day rule. */
export async function setRecurringActive(actor: WorkActor, templateId: string, active: boolean): Promise<WorkResult> {
  const storeId = actor.store.id;
  if (!isUuid(templateId)) return problem(NOT_FOUND);
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const changed = await tx.execute<Row>(sql`
        update commerce.work_recurring_invoices set is_active = ${active}, updated_at = now()
        where store_id = ${storeId}::uuid and id = ${templateId}::uuid and is_active <> ${active}
        returning id
      `);
      if (changed.length === 0) {
        const [exists] = await tx.execute<Row>(
          sql`select 1 as ok from commerce.work_recurring_invoices where store_id = ${storeId}::uuid and id = ${templateId}::uuid`,
        );
        return exists ? { ok: true } : problem(NOT_FOUND);
      }
      await workEvent(tx, storeId, ENTITY, templateId, active ? "recurring.resumed" : "recurring.paused", {}, actor.account?.id ?? null);
      return { ok: true };
    }),
  );
}

/**
 * Removes a template that has never made an invoice. One that has cannot be deleted (its invoices
 * point at it): "archive" it by pausing it, which is what `setRecurringActive` does.
 */
export async function deleteRecurring(actor: WorkActor, templateId: string): Promise<WorkResult> {
  const storeId = actor.store.id;
  if (!isUuid(templateId)) return problem(NOT_FOUND);
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const [template] = await tx.execute<Row>(sql`
        select name from commerce.work_recurring_invoices where store_id = ${storeId}::uuid and id = ${templateId}::uuid for update
      `);
      if (!template) return problem(NOT_FOUND);
      const [made] = await tx.execute<Row>(sql`
        select 1 as any from commerce.work_invoices where store_id = ${storeId}::uuid and recurring_invoice_id = ${templateId}::uuid limit 1
      `);
      if (made) return problem("This repeating invoice has made invoices, so it cannot be deleted. Pause it instead.");
      await tx.execute(
        sql`delete from commerce.work_recurring_invoices where store_id = ${storeId}::uuid and id = ${templateId}::uuid`,
      );
      await workEvent(tx, storeId, ENTITY, templateId, "recurring.deleted", { name: String(template.name) }, actor.account?.id ?? null);
      return { ok: true };
    }),
  );
}

// --- Generating a period's draft --------------------------------------------------------------------------

type Source = "job" | "person";

export type GeneratedPeriod = WorkResult<{ invoiceId: string; created: boolean; period: Day }>;

/**
 * One period's draft, made once: the template row is locked, the period is checked again under the
 * lock (a template paused or a period skipped a moment ago is not made), and the insert does nothing
 * when the period already has an invoice, so overlapping runs make one between them. The line comes
 * from the template; the draft is priced (and its VAT aligned with the client's) in the same
 * transaction. `created` says whether this call made it.
 */
async function generatePeriod(
  actor: WorkActor,
  templateId: string,
  period: Day,
  source: Source,
): Promise<GeneratedPeriod> {
  const storeId = actor.store.id;
  return workGuard(() =>
    db().transaction(async (tx): Promise<GeneratedPeriod> => {
      const [row] = await tx.execute<Row>(sql`
        select ${COLUMNS}, (select archived_at is not null from commerce.work_clients c
                             where c.store_id = r.store_id and c.id = r.client_id) as client_archived
        from commerce.work_recurring_invoices r
        where store_id = ${storeId}::uuid and id = ${templateId}::uuid
        for update
      `);
      if (!row) return problem(NOT_FOUND);
      const template = toTemplate(row);
      if (row.client_archived) return problem("This client is archived. Restore it before invoicing it.");
      if (source === "job" && !template.isActive) return problem("This repeating invoice is paused.");
      const today = await storeToday(tx, storeId);
      const due = duePeriods(planningView(template), today);
      if (!due.includes(period)) {
        return problem(
          template.skippedPeriods.includes(period)
            ? "This period was skipped. Restore it first."
            : "That is not a period that is due for this repeating invoice.",
        );
      }
      const [existing] = await tx.execute<Row>(sql`
        select id from commerce.work_invoices
        where store_id = ${storeId}::uuid and recurring_invoice_id = ${templateId}::uuid and recurring_period = ${period}::date
      `);
      if (existing) return { ok: true, invoiceId: String(existing.id), created: false, period };

      const service = servicePeriod(planningView(template).rule, period);
      const [made] = await tx.execute<Row>(sql`
        insert into commerce.work_invoices (store_id, client_id, recurring_invoice_id, recurring_period, currency, payment_days,
                                            service_from, service_to, created_by)
        values (${storeId}::uuid, ${template.clientId}::uuid, ${templateId}::uuid, ${period}::date, ${template.currency},
                ${template.paymentDays}, ${service.from}::date, ${service.to}::date, ${actor.account?.id ?? null}::uuid)
        on conflict (store_id, recurring_invoice_id, recurring_period) do nothing
        returning id
      `);
      if (!made) {
        const [other] = await tx.execute<Row>(sql`
          select id from commerce.work_invoices
          where store_id = ${storeId}::uuid and recurring_invoice_id = ${templateId}::uuid and recurring_period = ${period}::date
        `);
        return other ? { ok: true, invoiceId: String(other.id), created: false, period } : problem(NOT_FOUND);
      }
      const invoiceId = String(made.id);
      await tx.execute(sql`
        insert into commerce.work_invoice_lines (store_id, invoice_id, position, description, unit, quantity_hundredths,
                                                 unit_price_minor, discount_bp, vat_category)
        values (${storeId}::uuid, ${invoiceId}::uuid, 0, ${lineDescription(template.description || template.name)}, ${template.unit},
                ${template.quantityHundredths}, ${template.unitPriceMinor}, ${template.discountBp}, ${template.vatCategory})
      `);
      // Prices the new draft (VAT aligned with the client's treatment) like every draft is kept; the client's other drafts are re-priced with it, unchanged.
      await refreshDraftInvoices(tx, { storeId, clientId: template.clientId });
      await workEvent(
        tx,
        storeId,
        "invoice",
        invoiceId,
        "invoice.created",
        { client_id: template.clientId, assignment_id: null, currency: template.currency, recurring_invoice_id: templateId, recurring_period: period },
        actor.account?.id ?? null,
      );
      await workEvent(tx, storeId, ENTITY, templateId, "recurring.generated", { period, invoice_id: invoiceId, source }, actor.account?.id ?? null);
      return { ok: true, invoiceId, created: true, period };
    }),
  );
}

/**
 * "Generate now": the draft of a due period that has no invoice: the one given, else the oldest.
 * Unlike the job it looks the whole window back, because a person asked for it; it works on a paused
 * template too. A period that already has an invoice is answered with that invoice, not a second one.
 */
export async function generateRecurringNow(actor: WorkActor, templateId: string, period?: string | null): Promise<GeneratedPeriod> {
  const storeId = actor.store.id;
  if (!isUuid(templateId)) return problem(NOT_FOUND);
  let wanted = period ?? null;
  if (wanted !== null && !isDay(wanted)) return problem("Give the period as a date.");
  if (wanted === null) {
    const state = await stateOf(storeId, templateId);
    if (!state) return problem(NOT_FOUND);
    const missing = openPeriods(state.plan, state.instances, state.today).find((o) => o.invoiceId === null);
    if (!missing) return problem("Every period that is due already has an invoice.");
    wanted = missing.period;
  }
  return generatePeriod(actor, templateId, wanted, "person");
}

/** A template with its instances and today, for the functions that act on one template. */
async function stateOf(storeId: string, templateId: string) {
  const run = readDb();
  const [row] = await run.execute<Row>(sql`
    select ${COLUMNS} from commerce.work_recurring_invoices where store_id = ${storeId}::uuid and id = ${templateId}::uuid
  `);
  if (!row) return null;
  const template = toTemplate(row);
  const today = await storeToday(run, storeId);
  const instances = await instancesOf(run, storeId, [templateId], recurrenceWindow(today).from);
  return { template, plan: planningView(template), instances, today };
}

// --- Skipping a period ---------------------------------------------------------------------------------------

/**
 * "Skip this period": it is never made, or, when its draft exists, the draft is deleted (which
 * skips it), and the job leaves it alone for good. An issued invoice cannot be skipped: credit it.
 */
export async function skipRecurringPeriod(actor: WorkActor, templateId: string, period: string): Promise<WorkResult> {
  const storeId = actor.store.id;
  if (!isUuid(templateId)) return problem(NOT_FOUND);
  if (!isDay(period)) return problem("Give the period as a date.");
  const state = await stateOf(storeId, templateId);
  if (!state) return problem(NOT_FOUND);
  if (!isOccurrenceDay(state.plan.rule, period) || period < state.template.startDate) {
    return problem("That is not one of this repeating invoice's periods.");
  }
  const instance = state.instances.find((i) => i.period === period);
  if (instance && instance.status !== "draft") {
    return problem("This period has been invoiced. Credit that invoice if it was a mistake.");
  }
  if (instance) {
    const deleted = await deleteDraft(actor, instance.invoiceId);
    if (!deleted.ok) return deleted;
  }
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const [row] = await tx.execute<Row>(sql`
        select 1 as ok from commerce.work_recurring_invoices
        where store_id = ${storeId}::uuid and id = ${templateId}::uuid for update
      `);
      if (!row) return problem(NOT_FOUND);
      // Sorted and without repeats, like the trigger that skips a deleted draft's period keeps it.
      await tx.execute(sql`
        update commerce.work_recurring_invoices
           set skipped_periods = (select array_agg(distinct d order by d) from unnest(skipped_periods || ${period}::date) as d),
               updated_at = now()
         where store_id = ${storeId}::uuid and id = ${templateId}::uuid and not (${period}::date = any (skipped_periods))
      `);
      await workEvent(tx, storeId, ENTITY, templateId, "recurring.skipped", { period }, actor.account?.id ?? null);
      return { ok: true };
    }),
  );
}

/** Takes a period off the skip list, so it can be generated again (by the job while it is within 40 days, or "Generate now"). */
export async function restoreRecurringPeriod(actor: WorkActor, templateId: string, period: string): Promise<WorkResult> {
  const storeId = actor.store.id;
  if (!isUuid(templateId)) return problem(NOT_FOUND);
  if (!isDay(period)) return problem("Give the period as a date.");
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const changed = await tx.execute<Row>(sql`
        update commerce.work_recurring_invoices set skipped_periods = array_remove(skipped_periods, ${period}::date), updated_at = now()
        where store_id = ${storeId}::uuid and id = ${templateId}::uuid and ${period}::date = any (skipped_periods)
        returning id
      `);
      if (changed.length === 0) return problem("That period is not skipped.");
      await workEvent(tx, storeId, ENTITY, templateId, "recurring.restored", { period }, actor.account?.id ?? null);
      return { ok: true };
    }),
  );
}

// --- Issuing ---------------------------------------------------------------------------------------------------

export type IssuedRecurring = WorkResult<{
  invoiceId: string;
  documentNumber: string;
  /** Whether the email went out; false with `emailReason` when it did not (the invoice is issued all the same). */
  emailed: boolean;
  emailReason?: string;
}>;

type IssueOutcome =
  | { ok: true; documentNumber: string; emailed: boolean; emailReason?: string }
  | { ok: false; problems: string[]; code?: string };

/**
 * Issues a draft of a template through the invoice module's own path (the checklist, the number, the
 * frozen amounts), and then emails it, apart from it: when the mail fails the invoice stays issued and
 * the failure is recorded on the template's history. Issued on the store's today, never the period's day.
 */
async function issueDraft(
  actor: WorkActor,
  templateId: string,
  period: Day,
  invoiceId: string,
  options: { email: boolean; source: Source },
): Promise<IssueOutcome> {
  const storeId = actor.store.id;
  const issued = await issueInvoice(actor, { invoiceId });
  if (!issued.ok) return { ok: false, problems: issued.problems, code: issued.code };
  const documentNumber = issued.invoice.documentNumber;
  await workEvent(
    db(),
    storeId,
    ENTITY,
    templateId,
    "recurring.issued",
    { period, invoice_id: invoiceId, document_number: documentNumber, source: options.source },
    actor.account?.id ?? null,
  );
  if (!options.email) return { ok: true, documentNumber, emailed: false, emailReason: "not_requested" };
  let emailed = false;
  let reason: string | undefined;
  try {
    const sent = await sendInvoiceEmail(storeId, invoiceId, { by: actor.account?.id ?? null });
    emailed = sent.sent;
    reason = sent.reason;
  } catch (error) {
    reason = "error";
    console.error("Recurring invoice email failed", { storeId, invoiceId, error });
  }
  if (!emailed) {
    await workEvent(
      db(),
      storeId,
      ENTITY,
      templateId,
      "recurring.email_failed",
      { period, invoice_id: invoiceId, reason: reason ?? "not_sent" },
      actor.account?.id ?? null,
    ).catch(() => {});
  }
  return { ok: true, documentNumber, emailed, emailReason: emailed ? undefined : (reason ?? "not_sent") };
}

/**
 * "Issue now": issues the draft of a due period, making it first when the period has none, and emails
 * it unless told not to. A period that is already issued answers that it is. The invoice's
 * readiness problems (a missing VAT number, a foreign currency without a rate) come back as they do
 * on the invoice page.
 */
export async function issueRecurringNow(
  actor: WorkActor,
  templateId: string,
  period: string,
  options: { email?: boolean } = {},
): Promise<IssuedRecurring> {
  const storeId = actor.store.id;
  if (!isUuid(templateId)) return problem(NOT_FOUND);
  if (!isDay(period)) return problem("Give the period as a date.");
  const state = await stateOf(storeId, templateId);
  if (!state) return problem(NOT_FOUND);
  const existing = state.instances.find((i) => i.period === period);
  if (existing && existing.status !== "draft") return problem("This period has already been issued.");
  let invoiceId = existing?.invoiceId ?? null;
  if (!invoiceId) {
    const made = await generatePeriod(actor, templateId, period, "person");
    if (!made.ok) return made;
    invoiceId = made.invoiceId;
  }
  const outcome = await issueDraft(actor, templateId, period, invoiceId, { email: options.email ?? true, source: "person" });
  if (!outcome.ok) {
    return {
      ok: false,
      problems: [...outcome.problems, "The invoice is kept as a draft. Open it to fix this and issue it."].filter(
        (p, i, all) => all.indexOf(p) === i,
      ),
    };
  }
  return { ok: true, invoiceId, documentNumber: outcome.documentNumber, emailed: outcome.emailed, emailReason: outcome.emailReason };
}

// --- The five-minute job -----------------------------------------------------------------------------------

export type RecurringRun = {
  stores: number;
  generated: number;
  issued: number;
  emailed: number;
  /** Drafts the job could not issue, and steps that failed: they are tried again by the next run. */
  failed: number;
};

/** Once a day per draft is enough to say why it was not issued. */
async function recordIssueFailure(storeId: string, templateId: string, invoiceId: string, period: Day, problems: string[]) {
  const [recent] = await db().execute<Row>(sql`
    select 1 as seen from commerce.work_events
    where store_id = ${storeId}::uuid and entity_type = ${ENTITY} and entity_id = ${templateId}::uuid
      and type = 'recurring.issue_failed' and data ->> 'invoice_id' = ${invoiceId}
      and created_at > now() - interval '1 day'
    limit 1
  `);
  if (recent) return;
  await workEvent(db(), storeId, ENTITY, templateId, "recurring.issue_failed", { period, invoice_id: invoiceId, problems }, null);
}

/**
 * Every five minutes, for each store with Work on (and not closed), in its own calendar:
 *
 *  1. drafts for the periods that are due, within 40 days, not skipped, of active templates;
 *  2. for templates with `auto_issue`, issue each new draft and any older draft of a due period,
 *     and email what was issued.
 *
 * Idempotent (run again and nothing more happens) and safe to overlap: each period is made once
 * under the template's lock, and only the run that issues an invoice emails it. One failing template
 * or store never stops the rest, and nothing here throws.
 */
export async function prepareDueRecurringWork(options: { now?: Date; storeId?: string } = {}): Promise<RecurringRun> {
  const result: RecurringRun = { stores: 0, generated: 0, issued: 0, emailed: 0, failed: 0 };
  let stores: Row[];
  try {
    stores = await db().execute<Row>(sql`
      select s.id, s.time_zone from commerce.stores s
      where 'work' = any (s.modules) and s.status <> 'closed'
        and (${options.storeId ?? null}::uuid is null or s.id = ${options.storeId ?? null}::uuid)
        and exists (select 1 from commerce.work_recurring_invoices r where r.store_id = s.id and r.is_active)
      order by s.id
    `);
  } catch (error) {
    console.error("Recurring invoices: could not list the stores", error);
    result.failed += 1;
    return result;
  }
  for (const store of stores) {
    try {
      await prepareStore(String(store.id), todayIn(String(store.time_zone), options.now ?? new Date()), result);
      result.stores += 1;
    } catch (error) {
      result.failed += 1;
      console.error("Recurring invoices failed for a store", { storeId: String(store.id), error });
    }
  }
  return result;
}

async function prepareStore(storeId: string, today: Day, result: RecurringRun): Promise<void> {
  const actor: WorkActor = { account: null, store: { id: storeId } };
  const rows = await db().execute<Row>(sql`
    select ${COLUMNS} from commerce.work_recurring_invoices r
    where store_id = ${storeId}::uuid and is_active
      and not exists (select 1 from commerce.work_clients c where c.store_id = r.store_id and c.id = r.client_id and c.archived_at is not null)
    order by id
    limit ${MAX_TEMPLATES_PER_STORE}
  `);
  const templates = rows.map(toTemplate);
  if (templates.length === 0) return;
  const instances = await instancesOf(db(), storeId, templates.map((t) => t.id), recurrenceWindow(today).from);
  const plan = planRecurring({ templates: templates.map(planningView), existing: instances, today });

  type Job = { templateId: string; period: Day; invoiceId: string | null; issue: boolean };
  const jobs: Job[] = [
    ...plan.generate.map((g) => ({ templateId: g.templateId, period: g.period, invoiceId: null, issue: g.issueAfter })),
    ...plan.issue.map((i) => ({ templateId: i.templateId, period: i.period, invoiceId: i.invoiceId, issue: true })),
  ].sort((a, b) => (a.period === b.period ? a.templateId.localeCompare(b.templateId) : a.period < b.period ? -1 : 1));

  for (const job of jobs) {
    try {
      let invoiceId = job.invoiceId;
      if (invoiceId === null) {
        const made = await generatePeriod(actor, job.templateId, job.period, "job");
        if (!made.ok) {
          result.failed += 1;
          continue;
        }
        invoiceId = made.invoiceId;
        if (made.created) result.generated += 1;
        // Another run made it a moment ago: it is that run's to issue.
        if (!made.created) continue;
      }
      if (!job.issue) continue;
      const outcome = await issueDraft(actor, job.templateId, job.period, invoiceId, { email: true, source: "job" });
      if (outcome.ok) {
        result.issued += 1;
        if (outcome.emailed) result.emailed += 1;
      } else if (outcome.code !== "not_draft") {
        result.failed += 1;
        await recordIssueFailure(storeId, job.templateId, invoiceId, job.period, outcome.problems);
      }
    } catch (error) {
      result.failed += 1;
      console.error("Recurring invoice step failed", { storeId, templateId: job.templateId, period: job.period, error });
    }
  }
}
