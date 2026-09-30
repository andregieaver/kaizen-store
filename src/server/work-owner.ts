import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db, readDb } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { effectiveRate, type BillingType } from "@/lib/work-calc";
import { isDay, daysOverdue, isOverdue, todayIn } from "@/lib/work-dates";
import {
  workOverview,
  type OverviewEntry,
  type OverviewInvoice,
  type OverviewTimer,
} from "@/lib/work-overview";
import { workBase } from "@/lib/work-paths";
import {
  combineOverviews,
  mergeReports,
  timeVisibility,
  type CombinedOverview,
  type CurrencyTotal,
  type OwnerReport,
  type StoreMarket,
  type StoreOverview,
  type WorkRole,
  type WorkStore,
} from "@/lib/work-owner";
import type { ReportParams } from "@/lib/work-reports";
import { sellerReadiness } from "@/lib/work-settings";
import { billableMinutes, filterTimeEntries, invoiceableMinutes, totalMinutes } from "@/lib/work-time";
import type { ReadinessProblem, SellerDetails } from "@/lib/work-vat";

import type { Account } from "./auth";
import { getStore } from "./stores";
import { problem, type WorkResult } from "./work-errors";
import { attentionHref } from "./work-overview";
import { getPeriodReport } from "./work-reports";
import type { InvoiceStatus } from "./work-invoices";
import type { TimeEntryItem } from "./work-time";
import { setWorkModule } from "./work-settings";

type Row = Record<string, unknown>;

/**
 * Work at the store owner's level (D123, docs/work.md "As built: combined owner view"): the clients, hours and
 * invoices of every store the account works in, side by side. The data stays in each store (each is the legal
 * seller); these readers only put the rows of several stores together.
 *
 * The rules that hold for every function here:
 * - The stores come from the account's membership (`workStoresFor()`), never from an address. A reader takes
 *   the stores it is to read and nothing else; ids from the URL are only ever used to choose among them
 *   (`scopeStores()`), so a store the account cannot see cannot be reached.
 * - One query for all the stores, for each kind of thing (never one set per store). Reports are the exception:
 *   each store's own `getPeriodReport()` is used, once per store, in parallel.
 * - Per-role visibility is the store pages': everyone who works in a store sees its clients, invoices, reports
 *   and overview; time is everyone's for an owner and one's own for anyone else.
 * - Money is never added across currencies (`src/lib/work-owner.ts`); days are each store's own.
 * - Nothing is written except by `switchWorkModule()`.
 */

const idList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
/** `column in (ids)`, or false for no ids (an empty list is a syntax error in SQL). */
const inStores = (column: SQL, ids: readonly string[]): SQL =>
  ids.length === 0 ? sql`false` : sql`${column} in (${idList(ids)})`;

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const int = (value: unknown): number => Number(value ?? 0);
const iso = (value: unknown): string | null => (value ? new Date(String(value)).toISOString() : null);
const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;
const orNull = (value: unknown): string | null =>
  value === null || value === undefined || value === "" ? null : String(value);

// --- The account's stores ----------------------------------------------------------------------------------

export type WorkStores = {
  /** Stores the account works in (owner or admin, not disabled, not closed) with Work on. */
  using: WorkStore[];
  /** Stores where Work is off and the account is an owner, so it can switch it on. */
  off: WorkStore[];
};

function toWorkStore(row: Row): WorkStore {
  const market = row.market as { code?: string; currency?: string; defaultLocale?: string } | null;
  const storeMarket: StoreMarket | null =
    market && market.code && market.currency && market.defaultLocale
      ? { code: market.code, currency: market.currency, defaultLocale: market.defaultLocale }
      : null;
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    timeZone: String(row.time_zone ?? "Europe/Oslo"),
    role: row.role as WorkRole,
    market: storeMarket,
    workOn: Boolean(row.work_on),
    lastUsedAt: iso(row.last_used),
  };
}

/**
 * The stores the account works in, split into those using Work and those where an owner could switch it on
 * (admins cannot, so a store with Work off and only an admin's membership is not listed at all). One query for
 * the account's whole set: membership, store, its main market and when the account last did something in its
 * Work. Ordered by name.
 */
export async function workStoresFor(account: Pick<Account, "id">): Promise<WorkStores> {
  const rows = await db().execute<Row>(sql`
    select s.id, s.slug, s.name, s.time_zone, m.role, ('work' = any(s.modules)) as work_on,
           (select json_build_object('code', mk.code, 'currency', mk.currency, 'defaultLocale', mk.default_locale)
              from commerce.markets mk
             where mk.store_id = s.id and mk.active
             order by (mk.code = s.country) desc nulls last, mk.created_at, mk.code
             limit 1) as market,
           (select max(ev.created_at) from commerce.work_events ev
             where ev.store_id = s.id and ev.account_id = m.account_id) as last_used
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id and s.status <> 'closed'
    where m.account_id = ${account.id}::uuid and m.disabled_at is null
    order by lower(s.name), s.slug
  `);
  const stores = rows.map(toWorkStore);
  return {
    using: stores.filter((store) => store.workOn),
    off: stores.filter((store) => !store.workOn && store.role === "owner"),
  };
}

// --- The overview ------------------------------------------------------------------------------------------

export type OwnerOverviewView = {
  combined: CombinedOverview;
  /** Names for what the overview shows, by id (ids are unique across stores). */
  clientNames: Record<string, string>;
  invoiceNumbers: Record<string, string>;
  assignmentNames: Record<string, { name: string; clientName: string }>;
  people: Record<string, string>;
  /** Stores that cannot issue an invoice yet, and what is missing (each store's own settings say the rest). */
  missing: { store: Pick<WorkStore, "slug" | "name">; problems: ReadinessProblem[] }[];
};

/**
 * The combined Work overview of the stores (docs/work.md 6.5): each store's `workOverview()` over its own rows,
 * read for all of them in a handful of queries, then put together by `combineOverviews()`: figures per currency
 * over all stores and per store, what needs attention, overdue invoices, unbilled time by client, running timers.
 */
export async function getOwnerOverview(stores: readonly WorkStore[], now = Date.now()): Promise<OwnerOverviewView> {
  const empty: OwnerOverviewView = {
    combined: combineOverviews([]),
    clientNames: {},
    invoiceNumbers: {},
    assignmentNames: {},
    people: {},
    missing: [],
  };
  if (stores.length === 0) return empty;
  const ids = stores.map((s) => s.id);

  const [invoiceRows, entryRows, timerRows, clientRows, sellers] = await Promise.all([
    readDb().execute<Row>(sql`
      select i.store_id, i.id, i.client_id, c.name as client_name, i.document_number, i.status, i.currency, i.total_minor,
             i.due_on::text as due_on, i.recurring_period::text as recurring_period,
             (i.paid_at at time zone s.time_zone)::date::text as paid_on,
             (i.updated_at at time zone s.time_zone)::date::text as updated_on,
             coalesce((select sum(p.amount_minor) from commerce.work_invoice_payments p
                        where p.store_id = i.store_id and p.invoice_id = i.id), 0)::bigint as paid_minor,
             coalesce((select sum(n.total_minor) from commerce.work_credit_notes n
                        where n.store_id = i.store_id and n.invoice_id = i.id), 0)::bigint as credited_minor
      from commerce.work_invoices i
      join commerce.stores s on s.id = i.store_id
      join commerce.work_clients c on c.store_id = i.store_id and c.id = i.client_id
      where ${inStores(sql`i.store_id`, ids)}
        and (i.status in ('draft', 'sent') or (i.status = 'paid' and i.paid_at >= now() - interval '40 days'))
    `),
    readDb().execute<Row>(sql`
      select e.store_id, e.assignment_id, a.client_id, c.name as client_name, a.billing_type, a.hourly_rate_minor,
             c.default_hourly_rate_minor, c.currency, e.work_date::text as work_date, e.minutes, e.billable,
             e.prepaid_minutes, e.invoice_line_id
      from commerce.work_time_entries e
      join commerce.work_assignments a on a.store_id = e.store_id and a.id = e.assignment_id
      join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
      where ${inStores(sql`e.store_id`, ids)} and e.billable and e.invoice_line_id is null and a.billing_type = 'hourly'
    `),
    readDb().execute<Row>(sql`
      select t.store_id, t.account_id, t.assignment_id, (extract(epoch from t.started_at) * 1000)::bigint as started_ms,
             a.name as assignment_name, c.name as client_name, coalesce(nullif(acc.name, ''), acc.email) as person
      from commerce.work_timers t
      join commerce.work_assignments a on a.store_id = t.store_id and a.id = t.assignment_id
      join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
      join commerce.accounts acc on acc.id = t.account_id
      where ${inStores(sql`t.store_id`, ids)}
    `),
    readDb().execute<Row>(sql`
      select store_id, count(*)::int as n from commerce.work_clients
      where ${inStores(sql`store_id`, ids)} and archived_at is null group by store_id
    `),
    sellerDetailsFor(ids),
  ]);

  const clientNames: Record<string, string> = {};
  const invoiceNumbers: Record<string, string> = {};
  const assignmentNames: OwnerOverviewView["assignmentNames"] = {};
  const people: Record<string, string> = {};

  const group = <T>(rows: readonly Row[], make: (r: Row) => T) => {
    const by = new Map<string, T[]>();
    for (const r of rows) {
      const list = by.get(String(r.store_id)) ?? [];
      list.push(make(r));
      by.set(String(r.store_id), list);
    }
    return by;
  };
  const invoices = group<OverviewInvoice>(invoiceRows, (r) => {
    clientNames[String(r.client_id)] = String(r.client_name);
    invoiceNumbers[String(r.id)] = String(r.document_number ?? "");
    return {
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
    };
  });
  const entries = group<OverviewEntry>(entryRows, (r) => {
    clientNames[String(r.client_id)] = String(r.client_name);
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
  const timers = group<OverviewTimer>(timerRows, (r) => {
    assignmentNames[String(r.assignment_id)] = { name: String(r.assignment_name), clientName: String(r.client_name) };
    people[String(r.account_id)] = String(r.person);
    return {
      accountId: String(r.account_id),
      assignmentId: String(r.assignment_id),
      startedAt: Number(r.started_ms),
    };
  });
  const clientCounts = new Map(clientRows.map((r) => [String(r.store_id), Number(r.n)]));

  const parts: StoreOverview[] = stores.map((store) => {
    const base = workBase(store.slug);
    const today = todayIn(store.timeZone, now);
    const overview = workOverview({
      today,
      now,
      invoices: invoices.get(store.id) ?? [],
      entries: entries.get(store.id) ?? [],
      timers: timers.get(store.id) ?? [],
      base,
      label: store.name,
    });
    overview.attention = overview.attention.map((item) => ({ ...item, href: attentionHref(item.href, base) }));
    return { store, today, overview, clientCount: clientCounts.get(store.id) ?? 0 };
  });

  const missing = stores.flatMap((store) => {
    const seller = sellers.get(store.id);
    const { problems } = seller ? sellerReadiness(seller) : { problems: [] };
    return problems.length > 0 ? [{ store: { slug: store.slug, name: store.name }, problems }] : [];
  });

  return {
    combined: combineOverviews(parts),
    clientNames,
    invoiceNumbers,
    assignmentNames,
    people,
    missing,
  };
}

/** The seller's details of several stores at once (`sellerDetails()` for many), by store id. */
async function sellerDetailsFor(ids: readonly string[]): Promise<Map<string, SellerDetails>> {
  if (ids.length === 0) return new Map();
  const rows = await readDb().execute<Row>(sql`
    select s.id, s.legal_name, s.organisation_number, s.postal_address, s.country,
           coalesce(w.vat_registered, true) as vat_registered, w.vat_number, w.bank_account
    from commerce.stores s left join commerce.work_settings w on w.store_id = s.id
    where ${inStores(sql`s.id`, ids)}
  `);
  return new Map(
    rows.map((row) => [
      String(row.id),
      {
        legalName: orNull(row.legal_name),
        organisationNumber: orNull(row.organisation_number),
        postalAddress: orNull(row.postal_address),
        country: orNull(row.country),
        vatRegistered: Boolean(row.vat_registered),
        vatNumber: orNull(row.vat_number),
        bankAccount: orNull(row.bank_account),
      },
    ]),
  );
}

// --- Clients -----------------------------------------------------------------------------------------------

export type OwnerClient = {
  id: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
  name: string;
  legalName: string | null;
  contactName: string | null;
  billingEmail: string | null;
  currency: string;
  archivedAt: string | null;
  activeAssignments: number;
  loggedMinutes: number;
  unbilledMinutes: number;
};

export type OwnerClientFilter = {
  /** `active` (the default) hides archived clients; `archived` shows only those. */
  archived?: "active" | "archived" | "all";
  /** Part of the name, legal name, contact or email, ignoring case. */
  search?: string;
};

const CLIENT_CAP = 1000;

/** The clients of the stores, by name, each with its store. At most 1 000; `truncated` says there were more. */
export async function listOwnerClients(
  stores: readonly WorkStore[],
  filter: OwnerClientFilter = {},
): Promise<{ clients: OwnerClient[]; truncated: boolean }> {
  if (stores.length === 0) return { clients: [], truncated: false };
  const archived = filter.archived ?? "active";
  const search = (filter.search ?? "").trim().toLowerCase() || null;
  const byId = new Map(stores.map((s) => [s.id, s]));
  const rows = await readDb().execute<Row>(sql`
    select c.id, c.store_id, c.name, c.legal_name, c.contact_name, c.billing_email, c.currency, c.archived_at,
      (select count(*)::int from commerce.work_assignments a
        where a.store_id = c.store_id and a.client_id = c.id and a.status = 'active') as active_assignments,
      coalesce(t.logged, 0)::int as logged_minutes,
      coalesce(t.unbilled, 0)::int as unbilled_minutes
    from commerce.work_clients c
    left join lateral (
      select sum(e.minutes) as logged,
             sum(greatest(0, e.minutes - e.prepaid_minutes)) filter (where e.billable and e.invoice_line_id is null) as unbilled
      from commerce.work_time_entries e
      join commerce.work_assignments a on a.store_id = e.store_id and a.id = e.assignment_id
      where a.store_id = c.store_id and a.client_id = c.id
    ) t on true
    where ${inStores(sql`c.store_id`, stores.map((s) => s.id))}
      and (${archived} = 'all' or (${archived} = 'active' and c.archived_at is null) or (${archived} = 'archived' and c.archived_at is not null))
      and (${search}::text is null
           or strpos(lower(c.name), ${search}::text) > 0
           or strpos(lower(coalesce(c.legal_name, '')), ${search}::text) > 0
           or strpos(lower(coalesce(c.contact_name, '')), ${search}::text) > 0
           or strpos(lower(coalesce(c.billing_email, '')), ${search}::text) > 0)
    order by lower(c.name), c.id
    limit ${CLIENT_CAP + 1}
  `);
  return {
    clients: rows.slice(0, CLIENT_CAP).map((row) => {
      const store = byId.get(String(row.store_id)) as WorkStore;
      return {
        id: String(row.id),
        storeId: store.id,
        storeSlug: store.slug,
        storeName: store.name,
        name: String(row.name),
        legalName: text(row.legal_name),
        contactName: text(row.contact_name),
        billingEmail: text(row.billing_email),
        currency: String(row.currency),
        archivedAt: iso(row.archived_at),
        activeAssignments: int(row.active_assignments),
        loggedMinutes: int(row.logged_minutes),
        unbilledMinutes: int(row.unbilled_minutes),
      };
    }),
    truncated: rows.length > CLIENT_CAP,
  };
}

// --- Time --------------------------------------------------------------------------------------------------

export type OwnerTimeEntry = TimeEntryItem & { storeId: string; storeSlug: string; storeName: string };

export type OwnerTimeFilter = {
  clientId?: string;
  assignmentId?: string;
  /** Who worked. */
  accountId?: string;
  from?: string;
  to?: string;
  billable?: boolean;
  billing?: "all" | "unbilled" | "on_draft" | "invoiced";
  query?: string;
  limit?: number;
  offset?: number;
};

export type OwnerTimeList = {
  entries: OwnerTimeEntry[];
  totals: { count: number; minutes: number; billableMinutes: number; unbilledMinutes: number };
  /** There were more entries than the 5 000 counted. */
  truncated: boolean;
};

const TIME_CAP = 5000;

/**
 * The time logged in the stores, newest first, narrowed like a store's Time page: everyone's time in the stores
 * where the account is an owner, only its own in the others (the visibility of the store page, decided by the
 * membership and never by the address). Totals count everything the filters match, not just the page. Minutes
 * are added across stores (they have no currency).
 */
export async function listOwnerTime(
  account: Pick<Account, "id">,
  stores: readonly WorkStore[],
  filter: OwnerTimeFilter = {},
): Promise<OwnerTimeList> {
  const empty: OwnerTimeList = {
    entries: [],
    totals: { count: 0, minutes: 0, billableMinutes: 0, unbilledMinutes: 0 },
    truncated: false,
  };
  if (stores.length === 0) return empty;
  for (const id of [filter.assignmentId, filter.clientId, filter.accountId]) {
    if (id !== undefined && !isUuid(id)) return empty;
  }
  for (const day of [filter.from, filter.to]) {
    if (day !== undefined && !isDay(day)) return empty;
  }
  const { everyone, ownOnly } = timeVisibility(stores);
  const byId = new Map(stores.map((s) => [s.id, s]));
  const billing = filter.billing ?? "all";
  const rows = await readDb().execute<Row>(sql`
    select e.store_id, e.id, e.assignment_id, a.name as assignment_name, a.client_id, c.name as client_name,
           e.task_id, t.title as task_title, e.account_id, coalesce(nullif(acc.name, ''), acc.email) as account_name,
           e.work_date::text as work_date, e.minutes, e.billable, e.note, e.prepaid_minutes,
           e.invoice_line_id, l.invoice_id, i.status as invoice_status, i.document_number, e.created_at
    from commerce.work_time_entries e
    join commerce.work_assignments a on a.store_id = e.store_id and a.id = e.assignment_id
    join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
    join commerce.accounts acc on acc.id = e.account_id
    left join commerce.work_tasks t on t.store_id = e.store_id and t.id = e.task_id
    left join commerce.work_invoice_lines l on l.store_id = e.store_id and l.id = e.invoice_line_id
    left join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id
    where (${inStores(sql`e.store_id`, everyone)}
           or (${inStores(sql`e.store_id`, ownOnly)} and e.account_id = ${account.id}::uuid))
      and (${filter.assignmentId ?? null}::uuid is null or e.assignment_id = ${filter.assignmentId ?? null}::uuid)
      and (${filter.clientId ?? null}::uuid is null or a.client_id = ${filter.clientId ?? null}::uuid)
      and (${filter.accountId ?? null}::uuid is null or e.account_id = ${filter.accountId ?? null}::uuid)
      and (${filter.from ?? null}::date is null or e.work_date >= ${filter.from ?? null}::date)
      and (${filter.to ?? null}::date is null or e.work_date <= ${filter.to ?? null}::date)
      and (${filter.billable ?? null}::boolean is null or e.billable = ${filter.billable ?? null}::boolean)
      and (${billing} = 'all'
           or (${billing} = 'unbilled' and e.billable and e.invoice_line_id is null)
           or (${billing} = 'on_draft' and i.status = 'draft')
           or (${billing} = 'invoiced' and i.status in ('sent', 'paid')))
    order by e.work_date desc, e.created_at desc, e.id
    limit ${TIME_CAP + 1}
  `);
  const all = filterTimeEntries(
    rows.slice(0, TIME_CAP).map((row): OwnerTimeEntry => {
      const store = byId.get(String(row.store_id)) as WorkStore;
      const minutes = int(row.minutes);
      const prepaid = int(row.prepaid_minutes);
      const status = text(row.invoice_status) as TimeEntryItem["invoiceStatus"];
      return {
        id: String(row.id),
        storeId: store.id,
        storeSlug: store.slug,
        storeName: store.name,
        assignmentId: String(row.assignment_id),
        assignmentName: String(row.assignment_name),
        clientId: String(row.client_id),
        clientName: String(row.client_name),
        taskId: text(row.task_id),
        taskTitle: text(row.task_title),
        accountId: String(row.account_id),
        accountName: String(row.account_name),
        workDate: String(row.work_date),
        minutes,
        billable: Boolean(row.billable),
        note: text(row.note),
        prepaidMinutes: prepaid,
        invoiceableMinutes: Boolean(row.billable) ? Math.max(0, minutes - prepaid) : 0,
        invoiceLineId: text(row.invoice_line_id),
        invoiceId: text(row.invoice_id),
        invoiceStatus: status,
        invoiceNumber: text(row.document_number),
        locked: status === "sent" || status === "paid",
        createdAt: iso(row.created_at) as string,
      };
    }),
    { taskId: null, query: filter.query ?? "" },
  );
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.max(1, Math.min(TIME_CAP, filter.limit ?? 500));
  return {
    entries: all.slice(offset, offset + limit),
    totals: {
      count: all.length,
      minutes: totalMinutes(all),
      billableMinutes: billableMinutes(all),
      unbilledMinutes: invoiceableMinutes(all, { onlyUnbilled: true }),
    },
    truncated: rows.length > TIME_CAP,
  };
}

/** The people who work in the stores where the account is an owner, once each: who a time entry can be filtered by. */
export async function listOwnerPeople(stores: readonly WorkStore[]): Promise<{ id: string; name: string }[]> {
  const { everyone } = timeVisibility(stores);
  if (everyone.length === 0) return [];
  const rows = await readDb().execute<Row>(sql`
    select distinct a.id, coalesce(nullif(a.name, ''), a.email) as label
    from commerce.store_members m
    join commerce.accounts a on a.id = m.account_id
    where ${inStores(sql`m.store_id`, everyone)} and m.disabled_at is null
    order by 2, 1
  `);
  return rows.map((row) => ({ id: String(row.id), name: String(row.label) }));
}

// --- Invoices ----------------------------------------------------------------------------------------------

export type OwnerInvoiceFilter = {
  status?: InvoiceStatus;
  clientId?: string;
  /** Sent and not paid, due before today in the store's time zone. */
  overdue?: boolean;
  /** Issue dates, inclusive (drafts have none and drop out when a date is given). */
  issuedFrom?: string;
  issuedTo?: string;
  /** A number, a client's name, or the client's own reference. */
  search?: string;
  page?: number;
  pageSize?: number;
};

export type OwnerInvoiceRow = {
  id: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
  status: InvoiceStatus;
  documentNumber: string | null;
  clientId: string;
  clientName: string;
  assignmentName: string | null;
  currency: string;
  issuedOn: string | null;
  dueOn: string | null;
  totalMinor: number;
  creditedMinor: number;
  /** Still to be paid: 0 for a draft and a void invoice. */
  outstandingMinor: number;
  /** Today in the invoice's store's time zone, which "overdue" and "due soon" are worked out against. */
  today: string;
  overdue: boolean;
  daysOverdue: number;
};

export type OwnerInvoiceList = {
  rows: OwnerInvoiceRow[];
  /** Invoices matching the filter, over all pages. */
  total: number;
  page: number;
  pageSize: number;
  /** What the filter matches, per currency: never added across currencies. */
  totals: CurrencyTotal[];
  /** Counts for the status tabs over the stores (whatever the filter). */
  counts: { draft: number; sent: number; paid: number; void: number; overdue: number };
};

const INVOICE_PAGE_MAX = 100;

/**
 * The invoices of the stores, newest first (drafts first), filtered by status, client, overdue, issue dates and a
 * search, and paged. Overdue is each invoice's own store's day. The totals are the database's, per currency, for
 * everything the filter matches.
 */
export async function listOwnerInvoices(
  stores: readonly WorkStore[],
  filter: OwnerInvoiceFilter = {},
): Promise<OwnerInvoiceList> {
  const pageSize = Math.min(INVOICE_PAGE_MAX, Math.max(1, Math.trunc(filter.pageSize ?? 25)));
  const page = Math.max(1, Math.trunc(filter.page ?? 1));
  const empty: OwnerInvoiceList = {
    rows: [],
    total: 0,
    page,
    pageSize,
    totals: [],
    counts: { draft: 0, sent: 0, paid: 0, void: 0, overdue: 0 },
  };
  if (stores.length === 0) return empty;
  const ids = stores.map((s) => s.id);
  const byId = new Map(stores.map((s) => [s.id, s]));
  const storeToday = sql`(now() at time zone s.time_zone)::date`;

  const where: SQL[] = [inStores(sql`i.store_id`, ids)];
  if (filter.status) where.push(sql`i.status = ${filter.status}`);
  if (filter.clientId) where.push(isUuid(filter.clientId) ? sql`i.client_id = ${filter.clientId}::uuid` : sql`false`);
  if (filter.overdue) where.push(sql`i.status = 'sent' and i.due_on < ${storeToday}`);
  if (filter.issuedFrom && isDay(filter.issuedFrom)) where.push(sql`i.issued_on >= ${filter.issuedFrom}::date`);
  if (filter.issuedTo && isDay(filter.issuedTo)) where.push(sql`i.issued_on <= ${filter.issuedTo}::date`);
  const search = filter.search?.trim().toLowerCase();
  if (search) {
    where.push(sql`(strpos(lower(coalesce(i.document_number, '')), ${search}) > 0
                    or strpos(lower(c.name), ${search}) > 0
                    or strpos(lower(coalesce(c.legal_name, '')), ${search}) > 0
                    or strpos(lower(coalesce(i.reference, '')), ${search}) > 0)`);
  }
  const clause = sql.join(where, sql` and `);
  const paid = sql`coalesce((select sum(p.amount_minor) from commerce.work_invoice_payments p
                              where p.store_id = i.store_id and p.invoice_id = i.id), 0)`;
  const credited = sql`coalesce((select sum(n.total_minor) from commerce.work_credit_notes n
                                  where n.store_id = i.store_id and n.invoice_id = i.id), 0)`;
  const outstanding = sql`case when i.status in ('sent', 'paid') then greatest(0, i.total_minor - ${paid} - ${credited}) else 0 end`;

  const [rows, totalRows, countRows] = await Promise.all([
    readDb().execute<Row>(sql`
      select i.id, i.store_id, i.status, i.document_number, i.client_id, c.name as client_name, a.name as assignment_name,
             i.currency::text as currency, i.issued_on::text as issued_on, i.due_on::text as due_on, i.total_minor,
             ${credited} as credited_minor, ${outstanding} as outstanding_minor, ${storeToday}::text as today
      from commerce.work_invoices i
      join commerce.stores s on s.id = i.store_id
      join commerce.work_clients c on c.store_id = i.store_id and c.id = i.client_id
      left join commerce.work_assignments a on a.store_id = i.store_id and a.id = i.assignment_id
      where ${clause}
      order by (i.status = 'draft') desc, coalesce(i.issued_on, i.created_at::date) desc, i.number desc nulls first,
               i.created_at desc, i.id
      limit ${pageSize} offset ${(page - 1) * pageSize}
    `),
    readDb().execute<Row>(sql`
      select i.currency::text as currency, count(*)::int as n, coalesce(sum(i.total_minor), 0)::bigint as total_minor,
             coalesce(sum(${outstanding}), 0)::bigint as outstanding_minor
      from commerce.work_invoices i
      join commerce.stores s on s.id = i.store_id
      join commerce.work_clients c on c.store_id = i.store_id and c.id = i.client_id
      where ${clause}
      group by i.currency
    `),
    readDb().execute<Row>(sql`
      select count(*) filter (where i.status = 'draft')::int as draft, count(*) filter (where i.status = 'sent')::int as sent,
             count(*) filter (where i.status = 'paid')::int as paid, count(*) filter (where i.status = 'void')::int as void,
             count(*) filter (where i.status = 'sent' and i.due_on < ${storeToday})::int as overdue
      from commerce.work_invoices i join commerce.stores s on s.id = i.store_id
      where ${inStores(sql`i.store_id`, ids)}
    `),
  ]);
  const counts = countRows[0] ?? {};
  const totals: CurrencyTotal[] = totalRows
    .map((r) => ({
      currency: String(r.currency),
      count: int(r.n),
      totalMinor: int(r.total_minor),
      outstandingMinor: int(r.outstanding_minor),
    }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
  return {
    rows: rows.map((r): OwnerInvoiceRow => {
      const store = byId.get(String(r.store_id)) as WorkStore;
      const status = String(r.status) as InvoiceStatus;
      const dueOn = text(r.due_on);
      const today = String(r.today);
      return {
        id: String(r.id),
        storeId: store.id,
        storeSlug: store.slug,
        storeName: store.name,
        status,
        documentNumber: text(r.document_number),
        clientId: String(r.client_id),
        clientName: String(r.client_name),
        assignmentName: text(r.assignment_name),
        currency: String(r.currency),
        issuedOn: text(r.issued_on),
        dueOn,
        totalMinor: int(r.total_minor),
        creditedMinor: int(r.credited_minor),
        outstandingMinor: int(r.outstanding_minor),
        today,
        overdue: isOverdue({ status, dueOn }, today),
        daysOverdue: daysOverdue({ status, dueOn }, today),
      };
    }),
    total: totals.reduce((sum, t) => sum + t.count, 0),
    page,
    pageSize,
    totals,
    counts: {
      draft: int(counts.draft),
      sent: int(counts.sent),
      paid: int(counts.paid),
      void: int(counts.void),
      overdue: int(counts.overdue),
    },
  };
}

// --- Reports -----------------------------------------------------------------------------------------------

/**
 * The period report of the stores as one (`getPeriodReport()` for each store, in parallel, merged by
 * `mergeReports()`): rows per store, totals per currency. `byStore` says each store's period, which
 * `parseOwnerReportParams()` works out on the store's own day; a client filter is not part of it.
 */
export async function getOwnerReport(
  stores: readonly WorkStore[],
  byStore: ReadonlyMap<string, ReportParams>,
): Promise<OwnerReport> {
  const parts = await Promise.all(
    stores.map(async (store) => {
      const params = byStore.get(store.id);
      if (!params) throw new RangeError("A store needs its own period");
      const report = await getPeriodReport(
        { id: store.id, timeZone: store.timeZone, markets: store.market ? [toMarket(store.market)] : [] },
        { from: params.period.from, to: params.period.to, by: params.by, clientId: null },
      );
      return { store, report };
    }),
  );
  return mergeReports(parts);
}

// --- Settings ----------------------------------------------------------------------------------------------

export type OwnerSettingsRow = {
  store: WorkStore;
  /** Issued invoices and running timers, which turning Work off hides but keeps. Zero while Work is off. */
  issuedInvoices: number;
  runningTimers: number;
  /** What is missing before the first invoice; null while Work is off (nothing to say yet). */
  problems: ReadinessProblem[] | null;
};

/** What the settings page shows for each store: its switch, what it holds, and what is missing before an invoice. */
export async function getOwnerSettings(stores: readonly WorkStore[]): Promise<OwnerSettingsRow[]> {
  if (stores.length === 0) return [];
  const on = stores.filter((s) => s.workOn).map((s) => s.id);
  const [countRows, sellers] = await Promise.all([
    on.length === 0
      ? []
      : readDb().execute<Row>(sql`
          select s.id,
                 (select count(*)::int from commerce.work_invoices i where i.store_id = s.id and i.status <> 'draft') as issued,
                 (select count(*)::int from commerce.work_timers t where t.store_id = s.id) as timers
          from commerce.stores s where ${inStores(sql`s.id`, on)}
        `),
    sellerDetailsFor(on),
  ]);
  const counts = new Map(countRows.map((r) => [String(r.id), { issued: int(r.issued), timers: int(r.timers) }]));
  return stores.map((store) => {
    const seller = sellers.get(store.id);
    return {
      store,
      issuedInvoices: counts.get(store.id)?.issued ?? 0,
      runningTimers: counts.get(store.id)?.timers ?? 0,
      problems: store.workOn && seller ? sellerReadiness(seller).problems : null,
    };
  });
}

/**
 * Switches Work on or off in one store, for an owner of it (docs/work.md 5.1: what the Features page did, by
 * `setWorkModule()`, audited as `work.enabled` / `work.disabled`). The membership is read here from the account,
 * so a caller that passes any slug at all can only change a store the account owns; anyone else is refused
 * (an admin: "only an owner"; a non-member: the same words as a store that does not exist). Off hides Work and
 * deletes nothing. The caller calls `updateTag(storeTag(slug))`.
 */
export async function switchWorkModule(
  account: Account,
  storeSlug: string,
  enabled: boolean,
): Promise<WorkResult<{ slug: string; enabled: boolean }>> {
  const [membership] = await db().execute<Row>(sql`
    select m.role from commerce.store_members m
    join commerce.stores s on s.id = m.store_id and s.status <> 'closed'
    where s.slug = ${storeSlug} and m.account_id = ${account.id}::uuid and m.disabled_at is null
  `);
  if (!membership) return problem("That store was not found.");
  if (membership.role !== "owner") return problem("Only an owner can switch Work on or off.");
  const store = await getStore(storeSlug);
  if (!store) return problem("That store was not found.");
  await setWorkModule({ account, store, role: "owner" }, enabled);
  return { ok: true, slug: storeSlug, enabled };
}
