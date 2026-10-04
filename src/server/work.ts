import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db, readDb, type Db } from "@/db/client";
import { billableAmountMinor, effectiveRate, timeAmountMinor, type RateSource } from "@/lib/work-calc";
import {
  DEFAULT_ESTIMATE_ALERTS,
  estimateStage,
  remainingMinutes,
  utilisationPercent,
  type EstimateAlertSettings,
  type EstimateStage,
} from "@/lib/work-estimate";
import {
  ASSIGNMENT_STATUSES,
  assignmentInput,
  clientInput,
  taskInput,
  type BillingAddress,
  type ClientInput,
} from "@/lib/work-input";
import { DEFAULT_PAYMENT_DAYS } from "@/lib/work-dates";
import type { VatTreatment } from "@/lib/work-vat";

import { audit, type Membership } from "./auth";
import type { Store } from "./stores";
import { refreshDraftInvoices, removeLinesForTask, syncTaskToDraftLine } from "./work-draft-sync";
import { problem, workGuard, zodProblems, type WorkResult } from "./work-errors";
import { memberCan } from "./permissions";

type Row = Record<string, unknown>;
type Runner = Pick<Db, "execute">;

/**
 * Work's clients, assignments and tasks (docs/work.md 4.2, 4.9, 7.2 WP3).
 * Time entries and timers are in `work-time.ts`; invoices in `work-invoices.ts`.
 *
 * Every query takes the store's id, and a row of another store is never found
 * (the composite foreign keys refuse it as well). The callers check the
 * membership (`requirePermission()` in the actions); the functions that write take
 * it, as their neighbours do, for who did it and, where the rules ask, for
 * the role. Everything a browser sends is checked again with the schemas of
 * `src/lib/work-input.ts`. Readers return plain, serialisable objects: days
 * are `YYYY-MM-DD` text, moments ISO text, money integer minor units and
 * durations integer minutes.
 *
 * What is written here goes into `work_events` (`client.*`, `assignment.*`,
 * `task.*`) in the same transaction, as docs/work.md 4.2a lists; only deleting
 * a client is also in the audit log (4.9).
 */

// --- Small helpers ------------------------------------------------------------

const iso = (value: unknown): string | null => (value ? new Date(String(value)).toISOString() : null);
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const int = (value: unknown): number => Number(value ?? 0);
const intOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;

/** Records what happened in the store's Work history. */
export async function workEvent(
  run: Runner,
  storeId: string,
  entityType: string,
  entityId: string | null,
  type: string,
  data: Record<string, unknown>,
  accountId: string | null,
): Promise<void> {
  await run.execute(sql`
    select commerce.work_event(${storeId}::uuid, ${entityType}, ${entityId}::uuid, ${type}, ${JSON.stringify(data)}::jsonb, ${accountId}::uuid)
  `);
}

/** Owners do everything; admins everything except what 4.9 keeps for owners. */
export const isOwner = (member: Pick<Membership, "role" | "kind" | "permissions">): boolean => memberCan(member, "owner");

// --- Defaults for the forms -----------------------------------------------------

export type WorkFormDefaults = {
  /** The currency a new client starts with: the Work settings', else the store's main country's. */
  currency: string;
  /** The language of a new client's documents: the store's main language. */
  locale: string;
  paymentDays: number;
  /** What a new assignment's estimate warnings start as (the Work settings'). */
  estimateAlert: EstimateAlertSettings;
};

/** What a new client's and a new assignment's forms start with. */
export async function formDefaults(store: Pick<Store, "id" | "markets" | "localization">): Promise<WorkFormDefaults> {
  const [row] = await readDb().execute<Row>(sql`
    select default_currency, default_payment_days, estimate_alert_minutes, estimate_alert_popup, estimate_alert_sound
    from commerce.work_settings where store_id = ${store.id}::uuid
  `);
  const main = store.localization.locales[0] ?? "en";
  return {
    currency: text(row?.default_currency) ?? store.markets[0]?.nativeCurrency ?? "EUR",
    locale: /^[a-z]{2,3}(-[A-Z]{2})?$/.test(main) ? main : "en",
    paymentDays: row?.default_payment_days == null ? DEFAULT_PAYMENT_DAYS : int(row.default_payment_days),
    estimateAlert: row
      ? {
          minutes: intOrNull(row.estimate_alert_minutes),
          popup: Boolean(row.estimate_alert_popup),
          sound: Boolean(row.estimate_alert_sound),
        }
      : DEFAULT_ESTIMATE_ALERTS,
  };
}

// --- Clients -------------------------------------------------------------------

export type WorkClient = {
  id: string;
  name: string;
  legalName: string | null;
  organisationNumber: string | null;
  vatNumber: string | null;
  country: string | null;
  billingAddress: BillingAddress;
  billingEmail: string | null;
  contactName: string | null;
  phone: string | null;
  locale: string | null;
  currency: string;
  defaultHourlyRateMinor: number | null;
  paymentDays: number | null;
  business: boolean;
  vatTreatment: VatTreatment;
  customerCompanyId: string | null;
  customerId: string | null;
  usePrepaid: boolean;
  notes: string | null;
  /** When it was archived; null while it is in use. */
  archivedAt: string | null;
  sortOrder: number;
  createdAt: string;
};

/** A client with what the list and the client page show about its work. */
export type WorkClientItem = WorkClient & {
  /** Assignments that are `active`. */
  activeAssignments: number;
  /** All logged minutes, billable or not. */
  loggedMinutes: number;
  billableMinutes: number;
  /** Billable minutes no invoice line has taken yet, less what prepaid hours covered. */
  unbilledMinutes: number;
};

function toAddress(value: unknown): BillingAddress {
  const a = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    line1: String(a.line1 ?? ""),
    line2: String(a.line2 ?? ""),
    postalCode: String(a.postalCode ?? ""),
    city: String(a.city ?? ""),
  };
}

const toClient = (row: Row): WorkClient => ({
  id: String(row.id),
  name: String(row.name),
  legalName: text(row.legal_name),
  organisationNumber: text(row.organisation_number),
  vatNumber: text(row.vat_number),
  country: text(row.country),
  billingAddress: toAddress(row.billing_address),
  billingEmail: text(row.billing_email),
  contactName: text(row.contact_name),
  phone: text(row.phone),
  locale: text(row.locale),
  currency: String(row.currency),
  defaultHourlyRateMinor: intOrNull(row.default_hourly_rate_minor),
  paymentDays: intOrNull(row.payment_days),
  business: Boolean(row.business),
  vatTreatment: String(row.vat_treatment) as VatTreatment,
  customerCompanyId: text(row.customer_company_id),
  customerId: text(row.customer_id),
  usePrepaid: Boolean(row.use_prepaid),
  notes: text(row.notes),
  archivedAt: iso(row.archived_at),
  sortOrder: int(row.sort_order),
  createdAt: iso(row.created_at) as string,
});

const toClientItem = (row: Row): WorkClientItem => ({
  ...toClient(row),
  activeAssignments: int(row.active_assignments),
  loggedMinutes: int(row.logged_minutes),
  billableMinutes: int(row.billable_minutes),
  unbilledMinutes: int(row.unbilled_minutes),
});

const CLIENT_SELECT = sql`
  select c.*,
    (select count(*)::int from commerce.work_assignments a
      where a.store_id = c.store_id and a.client_id = c.id and a.status = 'active') as active_assignments,
    coalesce(t.logged, 0)::int as logged_minutes,
    coalesce(t.billable, 0)::int as billable_minutes,
    coalesce(t.unbilled, 0)::int as unbilled_minutes
  from commerce.work_clients c
  left join lateral (
    select sum(e.minutes) as logged,
           sum(e.minutes) filter (where e.billable) as billable,
           sum(greatest(0, e.minutes - e.prepaid_minutes)) filter (where e.billable and e.invoice_line_id is null) as unbilled
    from commerce.work_time_entries e
    join commerce.work_assignments a on a.store_id = e.store_id and a.id = e.assignment_id
    where a.store_id = c.store_id and a.client_id = c.id
  ) t on true
`;

export type ClientFilter = {
  /** `active` (the default) hides archived clients; `archived` shows only those. */
  archived?: "active" | "archived" | "all";
  /** Part of the name, legal name, contact or email, ignoring case. */
  search?: string;
};

/** The store's clients, in the order the owner arranged them, then by name. */
export async function listClients(storeId: string, filter: ClientFilter = {}): Promise<WorkClientItem[]> {
  const archived = filter.archived ?? "active";
  const search = (filter.search ?? "").trim().toLowerCase() || null;
  const rows = await readDb().execute<Row>(sql`
    ${CLIENT_SELECT}
    where c.store_id = ${storeId}::uuid
      and (${archived} = 'all' or (${archived} = 'active' and c.archived_at is null) or (${archived} = 'archived' and c.archived_at is not null))
      and (${search}::text is null
           or strpos(lower(c.name), ${search}::text) > 0
           or strpos(lower(coalesce(c.legal_name, '')), ${search}::text) > 0
           or strpos(lower(coalesce(c.contact_name, '')), ${search}::text) > 0
           or strpos(lower(coalesce(c.billing_email, '')), ${search}::text) > 0)
    order by c.sort_order, lower(c.name), c.id
  `);
  return rows.map(toClientItem);
}

/** One client of the store, or null (also for another store's id). */
export async function getClient(storeId: string, clientId: string): Promise<WorkClientItem | null> {
  if (!isUuid(clientId)) return null;
  const [row] = await readDb().execute<Row>(sql`
    ${CLIENT_SELECT}
    where c.store_id = ${storeId}::uuid and c.id = ${clientId}::uuid
  `);
  return row ? toClientItem(row) : null;
}

/** The address as it is kept: nothing at all when every part is empty. */
function addressJson(address: BillingAddress | null): string {
  if (!address) return "{}";
  const parts = [address.line1, address.line2, address.postalCode, address.city];
  return parts.every((part) => !part.trim()) ? "{}" : JSON.stringify(address);
}

/** The country and the customer company and person a client is linked to must exist, in this store. */
async function clientReferences(run: Runner, storeId: string, input: ClientInput): Promise<string[]> {
  const problems: string[] = [];
  if (input.country) {
    const [row] = await run.execute<Row>(sql`select 1 from commerce.countries where code = ${input.country}`);
    if (!row) problems.push("Choose a country from the list.");
  }
  if (input.customerCompanyId) {
    const [row] = await run.execute<Row>(sql`
      select 1 from commerce.customer_companies where store_id = ${storeId}::uuid and id = ${input.customerCompanyId}::uuid
    `);
    if (!row) problems.push("That customer company does not exist.");
  }
  if (input.customerId) {
    const [row] = await run.execute<Row>(sql`
      select 1 from commerce.customers where store_id = ${storeId}::uuid and id = ${input.customerId}::uuid
    `);
    if (!row) problems.push("That customer does not exist.");
  }
  return problems;
}

/** Adds a client (any member). */
export async function createClient({ account, store }: Membership, raw: unknown): Promise<WorkResult<{ id: string }>> {
  const parsed = clientInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult<{ id: string }>> => {
      const problems = await clientReferences(tx, store.id, input);
      if (problems.length > 0) return problem(...problems);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.work_clients (
          store_id, name, legal_name, organisation_number, vat_number, country, billing_address, billing_email,
          contact_name, phone, locale, currency, default_hourly_rate_minor, payment_days, business, vat_treatment,
          customer_company_id, customer_id, use_prepaid, notes, sort_order)
        values (
          ${store.id}::uuid, ${input.name}, ${input.legalName}, ${input.organisationNumber}, ${input.vatNumber},
          ${input.country}, ${addressJson(input.billingAddress)}::jsonb, ${input.billingEmail},
          ${input.contactName}, ${input.phone}, ${input.locale}, ${input.currency}, ${input.defaultHourlyRateMinor},
          ${input.paymentDays}, ${input.business}, ${input.vatTreatment},
          ${input.customerCompanyId}::uuid, ${input.customerId}::uuid, ${input.usePrepaid}, ${input.notes},
          coalesce((select max(sort_order) + 1 from commerce.work_clients where store_id = ${store.id}::uuid), 0))
        returning id
      `);
      const id = String(row.id);
      await workEvent(tx, store.id, "client", id, "client.created", { name: input.name }, account.id);
      return { ok: true, id };
    }),
  ) as Promise<WorkResult<{ id: string }>>;
}

/**
 * Changes a client (any member). Invoices already issued keep the details they were issued with; the
 * client's drafts are priced again (their VAT treatment follows the client's, docs/work.md 4.4).
 */
export async function updateClient(
  { account, store }: Membership,
  clientId: string,
  raw: unknown,
): Promise<WorkResult> {
  if (!isUuid(clientId)) return problem("This client no longer exists.");
  const parsed = clientInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const problems = await clientReferences(tx, store.id, input);
      if (problems.length > 0) return problem(...problems);
      const [row] = await tx.execute<Row>(sql`
        update commerce.work_clients set
          name = ${input.name}, legal_name = ${input.legalName}, organisation_number = ${input.organisationNumber},
          vat_number = ${input.vatNumber}, country = ${input.country}, billing_address = ${addressJson(input.billingAddress)}::jsonb,
          billing_email = ${input.billingEmail}, contact_name = ${input.contactName}, phone = ${input.phone},
          locale = ${input.locale}, currency = ${input.currency}, default_hourly_rate_minor = ${input.defaultHourlyRateMinor},
          payment_days = ${input.paymentDays}, business = ${input.business}, vat_treatment = ${input.vatTreatment},
          customer_company_id = ${input.customerCompanyId}::uuid, customer_id = ${input.customerId}::uuid,
          use_prepaid = ${input.usePrepaid}, notes = ${input.notes}, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${clientId}::uuid
        returning id
      `);
      if (!row) return problem("This client no longer exists.");
      await workEvent(tx, store.id, "client", clientId, "client.updated", { name: input.name }, account.id);
      await refreshDraftInvoices(tx, { storeId: store.id, clientId });
      return { ok: true };
    }),
  );
}

/**
 * Archives a client, or brings it back (any member). An archived client is
 * out of the lists and takes no new assignments; everything it has stays, and
 * its invoices are as they were. A client is never deleted once it has history.
 */
export async function setClientArchived(
  { account, store }: Membership,
  clientId: string,
  archived: boolean,
): Promise<WorkResult> {
  if (!isUuid(clientId)) return problem("This client no longer exists.");
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const [row] = await tx.execute<Row>(sql`
        update commerce.work_clients
        set archived_at = case when ${archived} then coalesce(archived_at, now()) else null end, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${clientId}::uuid
        returning id
      `);
      if (!row) return problem("This client no longer exists.");
      await workEvent(
        tx,
        store.id,
        "client",
        clientId,
        archived ? "client.archived" : "client.unarchived",
        {},
        account.id,
      );
      return { ok: true };
    }),
  );
}

/**
 * Deletes a client that has no history (owners only, 4.9): no assignments, no
 * invoices, no repeating invoices. Anything else is archived, never deleted.
 */
export async function deleteClient(member: Membership, clientId: string): Promise<WorkResult> {
  const { account, store } = member;
  if (!isOwner(member)) return problem("Only an owner can delete a client.");
  if (!isUuid(clientId)) return problem("This client no longer exists.");
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const [client] = await tx.execute<Row>(sql`
        select name,
          (select count(*)::int from commerce.work_assignments a where a.store_id = c.store_id and a.client_id = c.id) as assignments,
          (select count(*)::int from commerce.work_invoices i where i.store_id = c.store_id and i.client_id = c.id) as invoices,
          (select count(*)::int from commerce.work_recurring_invoices r where r.store_id = c.store_id and r.client_id = c.id) as templates
        from commerce.work_clients c
        where c.store_id = ${store.id}::uuid and c.id = ${clientId}::uuid
        for update
      `);
      if (!client) return problem("This client no longer exists.");
      if (int(client.assignments) + int(client.invoices) + int(client.templates) > 0) {
        return problem("This client has assignments or invoices, so it cannot be deleted. Archive it instead.");
      }
      await tx.execute(
        sql`delete from commerce.work_clients where store_id = ${store.id}::uuid and id = ${clientId}::uuid`,
      );
      await workEvent(tx, store.id, "client", clientId, "client.deleted", { name: String(client.name) }, account.id);
      await audit(account.id, store.id, "work.client.deleted", { clientId, name: String(client.name) });
      return { ok: true };
    }),
  );
}

// --- Assignments -----------------------------------------------------------------

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export type WorkAssignment = {
  id: string;
  clientId: string;
  name: string;
  status: AssignmentStatus;
  billingType: "hourly" | "fixed_fee";
  /** Its own hourly rate; null uses the client's default. */
  hourlyRateMinor: number | null;
  fixedAmountMinor: number | null;
  estimatedMinutes: number | null;
  startDate: string | null;
  endDate: string | null;
  /** Minutes before the estimate to warn; null: no warnings. */
  estimateAlertMinutes: number | null;
  estimateAlertPopup: boolean;
  estimateAlertSound: boolean;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
};

/** What an assignment has had and is worth, worked out in code from its entries. */
export type AssignmentSummary = {
  loggedMinutes: number;
  billableMinutes: number;
  /** Billable minutes no invoice line has taken yet, less what prepaid hours covered. */
  unbilledMinutes: number;
  /** The hourly rate that applies (its own, else the client's) and where it came from. */
  rateMinor: number;
  rateSource: RateSource;
  /** What the billable time comes to, net: the fixed fee, or the hours at the rate. */
  billableAmountMinor: number;
  /** What is still to invoice, net (a fixed fee counts until it is on an issued invoice). */
  unbilledAmountMinor: number;
  estimatedMinutes: number | null;
  /** Minutes left of the estimate, negative when over; null without an estimate. */
  remainingMinutes: number | null;
  /** How much of the estimate is used, as a whole percentage; null without an estimate. */
  utilisationPercent: number | null;
  /** `near` and `over` are what the estimate warnings say, at the assignment's own threshold. */
  stage: EstimateStage;
  /** An issued invoice bills it: for hourly work, and nothing is left unbilled; for a fixed fee, its line. Derived, never stored. */
  invoiced: boolean;
};

export type WorkAssignmentItem = WorkAssignment & {
  clientName: string;
  clientArchived: boolean;
  /** The client's currency, which its invoices start in. */
  currency: string;
  summary: AssignmentSummary;
  /** The assignment's draft invoice, if it has one (at most one at a time). */
  draftInvoiceId: string | null;
  /** Invoices of it that were issued (not counting draft ones). */
  issuedInvoices: number;
};

const toAssignment = (row: Row): WorkAssignment => ({
  id: String(row.id),
  clientId: String(row.client_id),
  name: String(row.name),
  status: String(row.status) as AssignmentStatus,
  billingType: String(row.billing_type) as WorkAssignment["billingType"],
  hourlyRateMinor: intOrNull(row.hourly_rate_minor),
  fixedAmountMinor: intOrNull(row.fixed_amount_minor),
  estimatedMinutes: intOrNull(row.estimated_minutes),
  startDate: text(row.start_date),
  endDate: text(row.end_date),
  estimateAlertMinutes: intOrNull(row.estimate_alert_minutes),
  estimateAlertPopup: Boolean(row.estimate_alert_popup),
  estimateAlertSound: Boolean(row.estimate_alert_sound),
  sortOrder: int(row.sort_order),
  createdBy: text(row.created_by),
  createdAt: iso(row.created_at) as string,
});

/** The figures of an assignment's summary, from what its entries add up to. */
export function summariseAssignment(
  assignment: Pick<
    WorkAssignment,
    "billingType" | "hourlyRateMinor" | "fixedAmountMinor" | "estimatedMinutes" | "estimateAlertMinutes"
  >,
  client: { defaultHourlyRateMinor: number | null },
  figures: { loggedMinutes: number; billableMinutes: number; unbilledMinutes: number; hasIssuedLine: boolean },
): AssignmentSummary {
  const { rateMinor, source } = effectiveRate(assignment, client);
  const remaining = remainingMinutes(assignment.estimatedMinutes, figures.loggedMinutes);
  const fixed = assignment.billingType === "fixed_fee";
  return {
    loggedMinutes: figures.loggedMinutes,
    billableMinutes: figures.billableMinutes,
    unbilledMinutes: figures.unbilledMinutes,
    rateMinor,
    rateSource: source,
    billableAmountMinor: billableAmountMinor(assignment, client, figures.billableMinutes),
    unbilledAmountMinor: fixed
      ? figures.hasIssuedLine
        ? 0
        : (assignment.fixedAmountMinor ?? 0)
      : timeAmountMinor(figures.unbilledMinutes, rateMinor),
    estimatedMinutes: assignment.estimatedMinutes,
    remainingMinutes: remaining,
    utilisationPercent: utilisationPercent(figures.loggedMinutes, assignment.estimatedMinutes),
    stage: estimateStage(remaining, assignment.estimateAlertMinutes),
    invoiced: figures.hasIssuedLine && (fixed || figures.unbilledMinutes === 0),
  };
}

const toAssignmentItem = (row: Row): WorkAssignmentItem => {
  const assignment = toAssignment(row);
  return {
    ...assignment,
    clientName: String(row.client_name),
    clientArchived: Boolean(row.client_archived_at),
    currency: String(row.client_currency),
    draftInvoiceId: text(row.draft_invoice_id),
    issuedInvoices: int(row.issued_invoices),
    summary: summariseAssignment(
      assignment,
      { defaultHourlyRateMinor: intOrNull(row.client_default_rate) },
      {
        loggedMinutes: int(row.logged_minutes),
        billableMinutes: int(row.billable_minutes),
        unbilledMinutes: int(row.unbilled_minutes),
        hasIssuedLine: Boolean(row.has_issued_line),
      },
    ),
  };
};

const ASSIGNMENT_SELECT = sql`
  select a.id, a.client_id, a.name, a.status, a.billing_type, a.hourly_rate_minor, a.fixed_amount_minor, a.estimated_minutes,
         a.start_date::text as start_date, a.end_date::text as end_date,
         a.estimate_alert_minutes, a.estimate_alert_popup, a.estimate_alert_sound, a.sort_order, a.created_by, a.created_at,
         c.name as client_name, c.currency as client_currency, c.default_hourly_rate_minor as client_default_rate,
         c.archived_at as client_archived_at,
         coalesce(t.logged, 0)::int as logged_minutes,
         coalesce(t.billable, 0)::int as billable_minutes,
         coalesce(t.unbilled, 0)::int as unbilled_minutes,
         (select i.id from commerce.work_invoices i
           where i.store_id = a.store_id and i.assignment_id = a.id and i.status = 'draft') as draft_invoice_id,
         (select count(*)::int from commerce.work_invoices i
           where i.store_id = a.store_id and i.assignment_id = a.id and i.status in ('sent', 'paid')) as issued_invoices,
         exists (select 1 from commerce.work_invoice_lines l
                   join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id
                  where l.store_id = a.store_id and l.assignment_id = a.id and i.status in ('sent', 'paid')) as has_issued_line
  from commerce.work_assignments a
  join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
  left join lateral (
    select sum(e.minutes) as logged,
           sum(e.minutes) filter (where e.billable) as billable,
           sum(greatest(0, e.minutes - e.prepaid_minutes)) filter (where e.billable and e.invoice_line_id is null) as unbilled
    from commerce.work_time_entries e
    where e.store_id = a.store_id and e.assignment_id = a.id
  ) t on true
`;

export type AssignmentFilter = {
  clientId?: string;
  /** `open` (the default) is active and paused; `all` everything. */
  status?: AssignmentStatus | "open" | "all";
  /** Assignments of archived clients are left out unless asked for. */
  includeArchivedClients?: boolean;
};

/** Assignments of the store, or of one client, with their summary figures. */
export async function listAssignments(storeId: string, filter: AssignmentFilter = {}): Promise<WorkAssignmentItem[]> {
  const clientId = filter.clientId ?? null;
  if (clientId !== null && !isUuid(clientId)) return [];
  const status = filter.status ?? "open";
  const rows = await readDb().execute<Row>(sql`
    ${ASSIGNMENT_SELECT}
    where a.store_id = ${storeId}::uuid
      and (${clientId}::uuid is null or a.client_id = ${clientId}::uuid)
      and (${status} = 'all' or (${status} = 'open' and a.status in ('active', 'paused')) or a.status = ${status})
      and (${filter.includeArchivedClients ?? false} or c.archived_at is null or ${clientId}::uuid is not null)
    order by c.sort_order, lower(c.name), a.sort_order, a.created_at, a.id
  `);
  return rows.map(toAssignmentItem);
}

/** One assignment with its summary, or null (also for another store's id). */
export async function getAssignment(storeId: string, assignmentId: string): Promise<WorkAssignmentItem | null> {
  if (!isUuid(assignmentId)) return null;
  const [row] = await readDb().execute<Row>(sql`
    ${ASSIGNMENT_SELECT}
    where a.store_id = ${storeId}::uuid and a.id = ${assignmentId}::uuid
  `);
  return row ? toAssignmentItem(row) : null;
}

/** An assignment with its tasks, in their order. */
export async function getAssignmentDetail(
  storeId: string,
  assignmentId: string,
): Promise<(WorkAssignmentItem & { tasks: WorkTaskItem[] }) | null> {
  const assignment = await getAssignment(storeId, assignmentId);
  if (!assignment) return null;
  return { ...assignment, tasks: await listTasks(storeId, assignmentId, assignment.estimateAlertMinutes) };
}

/** Creates an assignment for a client that is not archived (any member). It starts with no invoice: one is drafted from its time. */
export async function createAssignment(
  { account, store }: Membership,
  raw: unknown,
): Promise<WorkResult<{ id: string }>> {
  const parsed = assignmentInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult<{ id: string }>> => {
      const [client] = await tx.execute<Row>(sql`
        select archived_at from commerce.work_clients where store_id = ${store.id}::uuid and id = ${input.clientId}::uuid
      `);
      if (!client) return problem("Choose one of your clients.");
      if (client.archived_at)
        return problem("This client is archived. Bring it back before you give it an assignment.");
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.work_assignments (
          store_id, client_id, name, status, billing_type, hourly_rate_minor, fixed_amount_minor, estimated_minutes,
          start_date, end_date, estimate_alert_minutes, estimate_alert_popup, estimate_alert_sound, created_by, sort_order)
        values (
          ${store.id}::uuid, ${input.clientId}::uuid, ${input.name}, ${input.status}, ${input.billingType},
          ${input.hourlyRateMinor}, ${input.fixedAmountMinor}, ${input.estimatedMinutes},
          ${input.startDate}::date, ${input.endDate}::date,
          ${input.estimateAlertMinutes}, ${input.estimateAlertPopup}, ${input.estimateAlertSound}, ${account.id}::uuid,
          coalesce((select max(sort_order) + 1 from commerce.work_assignments
                     where store_id = ${store.id}::uuid and client_id = ${input.clientId}::uuid), 0))
        returning id
      `);
      const id = String(row.id);
      await workEvent(
        tx,
        store.id,
        "assignment",
        id,
        "assignment.created",
        { name: input.name, client_id: input.clientId, billing_type: input.billingType },
        account.id,
      );
      return { ok: true, id };
    }),
  ) as Promise<WorkResult<{ id: string }>>;
}

/**
 * Changes an assignment (any member). Its client can be changed only while it
 * has no time and no invoices. `invoiced` is never a status: it is derived
 * from the issued invoices that bill the assignment.
 */
export async function updateAssignment(
  { account, store }: Membership,
  assignmentId: string,
  raw: unknown,
): Promise<WorkResult> {
  if (!isUuid(assignmentId)) return problem("This assignment no longer exists.");
  const parsed = assignmentInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const [current] = await tx.execute<Row>(sql`
        select a.client_id, a.status,
          (select count(*)::int from commerce.work_time_entries e where e.store_id = a.store_id and e.assignment_id = a.id) as entries,
          (select count(*)::int from commerce.work_invoices i where i.store_id = a.store_id and i.assignment_id = a.id) as invoices
        from commerce.work_assignments a
        where a.store_id = ${store.id}::uuid and a.id = ${assignmentId}::uuid
        for update
      `);
      if (!current) return problem("This assignment no longer exists.");
      if (String(current.client_id) !== input.clientId) {
        if (int(current.entries) + int(current.invoices) > 0) {
          return problem("An assignment with time or invoices cannot move to another client.");
        }
        const [client] = await tx.execute<Row>(sql`
          select archived_at from commerce.work_clients where store_id = ${store.id}::uuid and id = ${input.clientId}::uuid
        `);
        if (!client) return problem("Choose one of your clients.");
        if (client.archived_at) return problem("This client is archived.");
      }
      await tx.execute(sql`
        update commerce.work_assignments set
          client_id = ${input.clientId}::uuid, name = ${input.name}, status = ${input.status}, billing_type = ${input.billingType},
          hourly_rate_minor = ${input.hourlyRateMinor}, fixed_amount_minor = ${input.fixedAmountMinor},
          estimated_minutes = ${input.estimatedMinutes}, start_date = ${input.startDate}::date, end_date = ${input.endDate}::date,
          estimate_alert_minutes = ${input.estimateAlertMinutes}, estimate_alert_popup = ${input.estimateAlertPopup},
          estimate_alert_sound = ${input.estimateAlertSound}, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${assignmentId}::uuid
      `);
      await workEvent(
        tx,
        store.id,
        "assignment",
        assignmentId,
        String(current.status) === input.status ? "assignment.updated" : "assignment.status_changed",
        { name: input.name, status: input.status },
        account.id,
      );
      return { ok: true };
    }),
  );
}

const statusInput = z.enum(ASSIGNMENT_STATUSES, "Choose active, paused or done.");

/**
 * Moves an assignment between `active`, `paused` and `done` (any member, in any
 * direction). A finished assignment can be reopened; a running timer on it
 * is left to its owner to stop.
 */
export async function setAssignmentStatus(
  { account, store }: Membership,
  assignmentId: string,
  status: unknown,
): Promise<WorkResult> {
  if (!isUuid(assignmentId)) return problem("This assignment no longer exists.");
  const parsed = statusInput.safeParse(status);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const [row] = await tx.execute<Row>(sql`
        update commerce.work_assignments set status = ${parsed.data}, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${assignmentId}::uuid
        returning id
      `);
      if (!row) return problem("This assignment no longer exists.");
      await workEvent(
        tx,
        store.id,
        "assignment",
        assignmentId,
        "assignment.status_changed",
        { status: parsed.data },
        account.id,
      );
      return { ok: true };
    }),
  );
}

/**
 * Deletes an assignment nobody has worked on or invoiced (any member). One with
 * time, invoices or a running timer is kept: set it to done instead, so the
 * time and the invoices stay explained.
 */
export async function deleteAssignment({ account, store }: Membership, assignmentId: string): Promise<WorkResult> {
  if (!isUuid(assignmentId)) return problem("This assignment no longer exists.");
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const [row] = await tx.execute<Row>(sql`
        select a.name,
          (select count(*)::int from commerce.work_time_entries e where e.store_id = a.store_id and e.assignment_id = a.id) as entries,
          (select count(*)::int from commerce.work_invoices i where i.store_id = a.store_id and i.assignment_id = a.id) as invoices,
          (select count(*)::int from commerce.work_timers t where t.store_id = a.store_id and t.assignment_id = a.id) as timers
        from commerce.work_assignments a
        where a.store_id = ${store.id}::uuid and a.id = ${assignmentId}::uuid
        for update
      `);
      if (!row) return problem("This assignment no longer exists.");
      if (int(row.entries) > 0)
        return problem("Time has been logged on this assignment, so it cannot be deleted. Mark it done instead.");
      if (int(row.invoices) > 0)
        return problem("This assignment has invoices, so it cannot be deleted. Mark it done instead.");
      if (int(row.timers) > 0) return problem("A timer is running on this assignment. Stop it first.");
      await tx.execute(
        sql`delete from commerce.work_assignments where store_id = ${store.id}::uuid and id = ${assignmentId}::uuid`,
      );
      await workEvent(
        tx,
        store.id,
        "assignment",
        assignmentId,
        "assignment.deleted",
        { name: String(row.name) },
        account.id,
      );
      return { ok: true };
    }),
  );
}

// --- Tasks -----------------------------------------------------------------------

export type WorkTask = {
  id: string;
  assignmentId: string;
  title: string;
  status: "open" | "done";
  estimatedMinutes: number | null;
  sortOrder: number;
  createdAt: string;
};

export type WorkTaskItem = WorkTask & {
  /** Everything logged on the task, billable or not (what an estimate warning counts). */
  loggedMinutes: number;
  billableMinutes: number;
  /** Minutes left of the task's estimate, negative when over; null without one. */
  remainingMinutes: number | null;
  utilisationPercent: number | null;
  /** The warning the task is at, with the assignment's threshold. */
  stage: EstimateStage;
};

const toTask = (row: Row): WorkTask => ({
  id: String(row.id),
  assignmentId: String(row.assignment_id),
  title: String(row.title),
  status: String(row.status) as WorkTask["status"],
  estimatedMinutes: intOrNull(row.estimated_minutes),
  sortOrder: int(row.sort_order),
  createdAt: iso(row.created_at) as string,
});

/** An assignment's tasks in their order, with the time on each. `alertMinutes` is the assignment's warning threshold. */
export async function listTasks(
  storeId: string,
  assignmentId: string,
  alertMinutes: number | null = null,
): Promise<WorkTaskItem[]> {
  if (!isUuid(assignmentId)) return [];
  const rows = await readDb().execute<Row>(sql`
    select t.id, t.assignment_id, t.title, t.status, t.estimated_minutes, t.sort_order, t.created_at,
      coalesce(e.logged, 0)::int as logged_minutes, coalesce(e.billable, 0)::int as billable_minutes
    from commerce.work_tasks t
    left join lateral (
      select sum(x.minutes) as logged, sum(x.minutes) filter (where x.billable) as billable
      from commerce.work_time_entries x
      where x.store_id = t.store_id and x.assignment_id = t.assignment_id and x.task_id = t.id
    ) e on true
    where t.store_id = ${storeId}::uuid and t.assignment_id = ${assignmentId}::uuid
    order by t.sort_order, t.created_at, t.id
  `);
  return rows.map((row) => {
    const task = toTask(row);
    const logged = int(row.logged_minutes);
    const remaining = remainingMinutes(task.estimatedMinutes, logged);
    return {
      ...task,
      loggedMinutes: logged,
      billableMinutes: int(row.billable_minutes),
      remainingMinutes: remaining,
      utilisationPercent: utilisationPercent(logged, task.estimatedMinutes),
      stage: estimateStage(remaining, alertMinutes),
    };
  });
}

/** One task of the store, or null. */
export async function getTask(storeId: string, taskId: string): Promise<WorkTask | null> {
  if (!isUuid(taskId)) return null;
  const [row] = await readDb().execute<Row>(sql`
    select id, assignment_id, title, status, estimated_minutes, sort_order, created_at
    from commerce.work_tasks where store_id = ${storeId}::uuid and id = ${taskId}::uuid
  `);
  return row ? toTask(row) : null;
}

/** Adds a task at the end of an assignment's list (any member). */
export async function createTask({ account, store }: Membership, raw: unknown): Promise<WorkResult<{ id: string }>> {
  const parsed = taskInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult<{ id: string }>> => {
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.work_tasks (store_id, assignment_id, title, status, estimated_minutes, sort_order)
        select a.store_id, a.id, ${input.title}, ${input.status}, ${input.estimatedMinutes},
               coalesce((select max(t.sort_order) + 1 from commerce.work_tasks t where t.store_id = a.store_id and t.assignment_id = a.id), 0)
        from commerce.work_assignments a
        where a.store_id = ${store.id}::uuid and a.id = ${input.assignmentId}::uuid
        returning id
      `);
      if (!row) return problem("This assignment no longer exists.");
      const id = String(row.id);
      await workEvent(
        tx,
        store.id,
        "task",
        id,
        "task.created",
        { title: input.title, assignment_id: input.assignmentId },
        account.id,
      );
      // A task and its line on the assignment's draft invoice are one piece of work: the line is made with it.
      await syncTaskToDraftLine(tx, {
        storeId: store.id,
        assignmentId: input.assignmentId,
        task: { id, title: input.title, estimatedMinutes: input.estimatedMinutes },
      });
      return { ok: true, id };
    }),
  ) as Promise<WorkResult<{ id: string }>>;
}

/**
 * Changes one thing about a task and records it. Each of the task setters below is one of these.
 * `after` runs in the same transaction, with the task as it now is.
 */
async function changeTask(
  { account, store }: Membership,
  taskId: string,
  set: SQL,
  type: string,
  data: Record<string, unknown>,
  after?: (tx: Db, task: Row) => Promise<void>,
): Promise<WorkResult> {
  if (!isUuid(taskId)) return problem("This task no longer exists.");
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const [row] = await tx.execute<Row>(sql`
        update commerce.work_tasks set ${set}, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${taskId}::uuid
        returning id, assignment_id, title, estimated_minutes
      `);
      if (!row) return problem("This task no longer exists.");
      await workEvent(tx, store.id, "task", taskId, type, data, account.id);
      if (after) await after(tx, row);
      return { ok: true };
    }),
  );
}

/** Renames a task (any member). Its line on a draft invoice is renamed with it, in the same transaction. */
export async function renameTask(member: Membership, taskId: string, title: unknown): Promise<WorkResult> {
  const parsed = taskInput.shape.title.safeParse(title);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  return changeTask(member, taskId, sql`title = ${parsed.data}`, "task.renamed", { title: parsed.data }, (tx, task) =>
    syncTaskToDraftLine(tx, {
      storeId: member.store.id,
      assignmentId: String(task.assignment_id),
      task: { id: taskId, title: String(task.title), estimatedMinutes: intOrNull(task.estimated_minutes) },
    }).then(() => undefined),
  );
}

/** Marks a task done or open again (any member). */
export async function setTaskStatus(member: Membership, taskId: string, status: unknown): Promise<WorkResult> {
  const parsed = z.enum(["open", "done"], "A task is open or done.").safeParse(status);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  return changeTask(member, taskId, sql`status = ${parsed.data}`, "task.toggled", { status: parsed.data });
}

/** Sets a task's estimate in minutes, or clears it with null (any member). */
export async function setTaskEstimate(member: Membership, taskId: string, minutes: unknown): Promise<WorkResult> {
  const parsed = taskInput.shape.estimatedMinutes.safeParse(minutes);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  return changeTask(member, taskId, sql`estimated_minutes = ${parsed.data}`, "task.estimated", {
    estimated_minutes: parsed.data,
  });
}

const orderInput = z.array(z.uuid()).max(500, "That is too many tasks to arrange at once.");

/**
 * Puts an assignment's tasks in the order given (any member), the way a drag
 * leaves them. Tasks not named (added by someone else meanwhile) keep their
 * order after the named ones; an id that is not one of the assignment's is refused.
 */
export async function reorderTasks(
  { account, store }: Membership,
  assignmentId: string,
  orderedIds: unknown,
): Promise<WorkResult> {
  if (!isUuid(assignmentId)) return problem("This assignment no longer exists.");
  const parsed = orderInput.safeParse(orderedIds);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const ids = [...new Set(parsed.data)];
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const [assignment] = await tx.execute<Row>(sql`
        select id from commerce.work_assignments where store_id = ${store.id}::uuid and id = ${assignmentId}::uuid for update
      `);
      if (!assignment) return problem("This assignment no longer exists.");
      const own = await tx.execute<Row>(sql`
        select id from commerce.work_tasks where store_id = ${store.id}::uuid and assignment_id = ${assignmentId}::uuid
      `);
      const ownIds = new Set(own.map((row) => String(row.id)));
      if (ids.some((id) => !ownIds.has(id))) return problem("One of those tasks is not on this assignment.");
      const arrangement =
        ids.length > 0
          ? sql`array[${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )}]`
          : sql`array[]::uuid[]`;
      await tx.execute(sql`
        update commerce.work_tasks t set sort_order = ranked.position, updated_at = now()
        from (
          select x.id, (row_number() over (
                   order by coalesce(array_position(${arrangement}, x.id), 1000000), x.sort_order, x.created_at, x.id) - 1)::int as position
          from commerce.work_tasks x
          where x.store_id = ${store.id}::uuid and x.assignment_id = ${assignmentId}::uuid
        ) ranked
        where t.store_id = ${store.id}::uuid and t.id = ranked.id and t.sort_order <> ranked.position
      `);
      await workEvent(tx, store.id, "assignment", assignmentId, "task.reordered", { count: ids.length }, account.id);
      return { ok: true };
    }),
  );
}

/**
 * Deletes a task (any member). Its time stays on the assignment, without a
 * task; its line on a draft invoice goes with it (the time on that line is
 * released), while a line on an issued invoice is a document and stays.
 * Refused while a timer runs on it, or when time logged on it is on an issued
 * invoice (the entries could no longer be released): mark it done instead.
 */
export async function deleteTask({ account, store }: Membership, taskId: string): Promise<WorkResult> {
  if (!isUuid(taskId)) return problem("This task no longer exists.");
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const [task] = await tx.execute<Row>(sql`
        select t.title, t.assignment_id,
          (select count(*)::int from commerce.work_timers w
            where w.store_id = t.store_id and w.assignment_id = t.assignment_id and w.task_id = t.id) as timers
        from commerce.work_tasks t
        where t.store_id = ${store.id}::uuid and t.id = ${taskId}::uuid
        for update
      `);
      if (!task) return problem("This task no longer exists.");
      if (int(task.timers) > 0) return problem("A timer is running on this task. Stop it first.");
      const [billed] = await tx.execute<Row>(sql`
        select 1 from commerce.work_time_entries e
        join commerce.work_invoice_lines l on l.store_id = e.store_id and l.id = e.invoice_line_id
        join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id
        where e.store_id = ${store.id}::uuid and e.task_id = ${taskId}::uuid and i.status in ('sent', 'paid')
        limit 1
      `);
      if (billed) return problem("Time on this task has been invoiced, so it cannot be deleted. Mark it done instead.");
      await removeLinesForTask(tx, { storeId: store.id, taskId });
      await tx.execute(
        sql`delete from commerce.work_tasks where store_id = ${store.id}::uuid and id = ${taskId}::uuid`,
      );
      await workEvent(
        tx,
        store.id,
        "task",
        taskId,
        "task.deleted",
        { title: String(task.title), assignment_id: String(task.assignment_id) },
        account.id,
      );
      return { ok: true };
    }),
  );
}
