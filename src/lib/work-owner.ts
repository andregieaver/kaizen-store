import { mainCurrency, toMarket } from "./markets";
import { buildCsv, csvFileName } from "./work-csv";
import { hundredthsToDecimal, minorToDecimal, minutesToHundredths } from "./work-calc";
import { todayIn, type Day } from "./work-dates";
import { workBase } from "./work-paths";
import type { AttentionItem, CurrencyFigures, WorkOverview } from "./work-overview";
import {
  parseReportParams,
  rowLabel,
  type PeriodReport,
  type ReportFigures,
  type ReportParams,
  type ReportRow,
  type ReportTotals,
} from "./work-reports";

/**
 * Work at the store owner's level (D123, docs/work.md): one place for the clients, hours and invoices of every
 * store the account works in. The data stays per store, and each store is the legal seller with its own numbers,
 * VAT, bank details and currency, so what this file does is put figures side by side without ever adding money
 * across currencies. Pure, so the server (`src/server/work-owner.ts`), the pages and the tests agree.
 *
 * The rules, as everywhere in Work: amounts are integer minor units; a sum is only ever made of amounts of the
 * same currency; minutes and counts, which have no currency, are added freely; a currency with nothing in it is
 * the store's own main currency, never a guess.
 */

/** Everything in the combined view is drawn in English and its number formats (the whole admin is English). */
export const WORK_LOCALE = "en";

export type WorkRole = "owner" | "admin";

/** The market a store keeps its money in, as the database has it (the country's own first). */
export type StoreMarket = { code: string; currency: string; defaultLocale: string };

/** A store the account works in, as the combined view knows it. Plain data, safe to send to the browser. */
export type WorkStore = {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
  role: WorkRole;
  /** The store's first market, whose currency is `mainCurrency`; null for a store with no market yet. */
  market: StoreMarket | null;
  /** Whether Work is switched on in it. */
  workOn: boolean;
  /** When this account last did something in the store's Work (a client, an invoice, time), or null. */
  lastUsedAt: string | null;
};

/** The currency a store's own country keeps its money in (`mainCurrency()`, the repo's one rule for it). */
export const storeMainCurrency = (store: Pick<WorkStore, "market">): string =>
  mainCurrency({ markets: store.market ? [toMarket(store.market)] : [] });

// --- Choosing stores ---------------------------------------------------------------------------------------

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

/** The store the address narrows to (`?store=acme`), or empty for all. Only text is read here; `scopeStores` decides. */
export const parseStoreParam = (params: Params): string => first(params.store).trim().slice(0, 100);

/**
 * The stores a list is about: the one the address names when the account works in it, else all of them. An
 * address naming a store the account cannot see is treated as "all", so a slug never leaks or opens anything: the
 * ids that reach a query always come from the account's own list, never from the address.
 */
export function scopeStores<T extends Pick<WorkStore, "slug">>(stores: readonly T[], slug: string): T[] {
  const one = slug ? stores.find((store) => store.slug === slug) : undefined;
  return one ? [one] : [...stores];
}

/** The slug the address has, only when it names one of the stores (so links never carry a stray value). */
export const activeStoreSlug = (stores: readonly Pick<WorkStore, "slug">[], slug: string): string =>
  stores.some((store) => store.slug === slug) ? slug : "";

/** `?a=1` and a store: adds `store=slug` to a query string that is empty or starts with `?`. */
export function withStore(query: string, slug: string): string {
  if (!slug) return query;
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  params.set("store", slug);
  return `?${params.toString()}`;
}

/**
 * Which store "New client" and "New invoice" start in: the store the list is narrowed to, else the only store,
 * else the one the account used last in Work (most recent activity), else the first. Null when there is none.
 */
export function defaultNewStore<T extends Pick<WorkStore, "slug" | "lastUsedAt">>(
  stores: readonly T[],
  narrowedTo: string,
): T | null {
  if (stores.length === 0) return null;
  const narrowed = narrowedTo ? stores.find((store) => store.slug === narrowedTo) : undefined;
  if (narrowed) return narrowed;
  if (stores.length === 1) return stores[0];
  const used = stores.filter((store) => store.lastUsedAt !== null);
  if (used.length === 0) return stores[0];
  return used.reduce((best, store) => ((store.lastUsedAt as string) > (best.lastUsedAt as string) ? store : best));
}

/** Where "New client" and "New invoice" lead once a store is chosen: that store's own create flow. */
export const newClientHref = (slug: string): string => `${workBase(slug)}/clients`;
export const newInvoiceHref = (slug: string): string => `${workBase(slug)}/invoices?new=1`;

/**
 * Whose time an account may see in a store: an owner sees everyone's, anyone else only their own (as the store's
 * own Time page does). The reader takes both lists and asks for the second only with the account's own id.
 */
export function timeVisibility<T extends Pick<WorkStore, "id" | "role">>(
  stores: readonly T[],
): { everyone: string[]; ownOnly: string[] } {
  return {
    everyone: stores.filter((store) => store.role === "owner").map((store) => store.id),
    ownOnly: stores.filter((store) => store.role !== "owner").map((store) => store.id),
  };
}

// --- Money, never across currencies ------------------------------------------------------------------------

function add(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new RangeError("An amount is too large to add");
  return sum;
}

const minDay = (a: Day | null, b: Day | null): Day | null => (a === null ? b : b === null ? a : a < b ? a : b);

/** The overview's figures of two stores in the same currency, added. */
export function addFigures(a: CurrencyFigures, b: CurrencyFigures): CurrencyFigures {
  if (a.currency !== b.currency) throw new RangeError("Amounts in different currencies are never added");
  const bucket = (x: { count: number; minor: number }, y: { count: number; minor: number }) => ({
    count: add(x.count, y.count),
    minor: add(x.minor, y.minor),
  });
  return {
    currency: a.currency,
    unbilled: {
      minutes: add(a.unbilled.minutes, b.unbilled.minutes),
      amountMinor: add(a.unbilled.amountMinor, b.unbilled.amountMinor),
      oldestWorkDate: minDay(a.unbilled.oldestWorkDate, b.unbilled.oldestWorkDate),
    },
    drafts: bucket(a.drafts, b.drafts),
    receivables: {
      notYetDue: bucket(a.receivables.notYetDue, b.receivables.notYetDue),
      dueSoon: bucket(a.receivables.dueSoon, b.receivables.dueSoon),
      overdue: {
        ...bucket(a.receivables.overdue, b.receivables.overdue),
        oldestDueOn: minDay(a.receivables.overdue.oldestDueOn, b.receivables.overdue.oldestDueOn),
      },
      outstandingMinor: add(a.receivables.outstandingMinor, b.receivables.outstandingMinor),
    },
    paidThisMonth: bucket(a.paidThisMonth, b.paidThisMonth),
  };
}

/** Figures of any number of stores, one entry per currency (added within a currency only), in currency order. */
export function figuresPerCurrency(all: readonly CurrencyFigures[]): CurrencyFigures[] {
  const byCurrency = new Map<string, CurrencyFigures>();
  for (const f of all) {
    const seen = byCurrency.get(f.currency);
    byCurrency.set(f.currency, seen ? addFigures(seen, f) : f);
  }
  return [...byCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

// --- The combined overview ---------------------------------------------------------------------------------

/** One store's overview, with the store it belongs to (`workOverview()` over that store's own rows). */
export type StoreOverview = {
  store: Pick<WorkStore, "id" | "slug" | "name">;
  today: Day;
  overview: WorkOverview;
  /** Clients that are not archived. */
  clientCount: number;
};

export type OwnerOverviewInvoice = WorkOverview["overdueInvoices"][number] & { storeSlug: string; storeName: string };
export type OwnerOverviewClientRow = WorkOverview["unbilledByClient"][number] & { storeSlug: string; storeName: string };
export type OwnerOverviewTimer = WorkOverview["runningTimers"][number] & { storeSlug: string; storeName: string };
export type OwnerAttention = AttentionItem & { storeSlug: string };

export type CombinedOverview = {
  /** All the stores together, one entry per currency. */
  currencies: CurrencyFigures[];
  /** Each store's own figures, in the order the stores were given. */
  perStore: {
    store: StoreOverview["store"];
    today: Day;
    /** In the store's own currencies; the store's main currency, all zero, when it has nothing to count. */
    currencies: CurrencyFigures[];
    counts: WorkOverview["counts"];
    clientCount: number;
    unbilledMinutes: number;
    runningTimers: number;
  }[];
  attention: OwnerAttention[];
  unbilledByClient: OwnerOverviewClientRow[];
  overdueInvoices: OwnerOverviewInvoice[];
  runningTimers: OwnerOverviewTimer[];
  counts: { overdue: number; drafts: number; runningTimers: number; unbilledMinutes: number };
  clientCount: number;
};

/**
 * The overviews of several stores as one: figures per currency over all stores, each store's own figures beside
 * them, what needs attention (urgent first) and the overdue invoices (oldest first), the unbilled time by client
 * and the running timers, each tagged with its store. Minutes and counts are added; money only within a currency.
 */
export function combineOverviews(parts: readonly StoreOverview[]): CombinedOverview {
  const attention: OwnerAttention[] = [];
  const overdue: OwnerOverviewInvoice[] = [];
  const unbilled: OwnerOverviewClientRow[] = [];
  const timers: OwnerOverviewTimer[] = [];
  for (const { store, overview } of parts) {
    const tag = { storeSlug: store.slug, storeName: store.name };
    for (const item of overview.attention) attention.push({ ...item, storeSlug: store.slug });
    for (const row of overview.overdueInvoices) overdue.push({ ...row, ...tag });
    for (const row of overview.unbilledByClient) unbilled.push({ ...row, ...tag });
    for (const timer of overview.runningTimers) timers.push({ ...timer, ...tag });
  }
  attention.sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)));
  overdue.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
  // By value within each currency; different currencies are not comparable, so they keep to their own order.
  unbilled.sort((a, b) =>
    a.currency === b.currency ? b.amountMinor - a.amountMinor : a.currency < b.currency ? -1 : 1,
  );
  timers.sort((a, b) => b.elapsedMinutes - a.elapsedMinutes);

  const perStore = parts.map(({ store, today, overview, clientCount }) => ({
    store,
    today,
    currencies: overview.currencies,
    counts: overview.counts,
    clientCount,
    unbilledMinutes: overview.currencies.reduce((sum, f) => add(sum, f.unbilled.minutes), 0),
    runningTimers: overview.runningTimers.length,
  }));
  const currencies = figuresPerCurrency(parts.flatMap((p) => p.overview.currencies));
  return {
    currencies,
    perStore,
    attention,
    unbilledByClient: unbilled,
    overdueInvoices: overdue,
    runningTimers: timers,
    counts: {
      overdue: overdue.length,
      drafts: currencies.reduce((sum, f) => add(sum, f.drafts.count), 0),
      runningTimers: timers.length,
      unbilledMinutes: currencies.reduce((sum, f) => add(sum, f.unbilled.minutes), 0),
    },
    clientCount: parts.reduce((sum, p) => add(sum, p.clientCount), 0),
  };
}

// --- Invoice totals, per currency ---------------------------------------------------------------------------

export type CurrencyTotal = { currency: string; count: number; totalMinor: number; outstandingMinor: number };

// --- The combined report -----------------------------------------------------------------------------------

export type OwnerReportRow = ReportRow & { storeId: string; storeSlug: string; storeName: string };

export type OwnerReport = {
  from: Day;
  to: Day;
  by: PeriodReport["by"];
  /** Rows of every store, store by store, each store's rows as its own report has them. */
  rows: OwnerReportRow[];
  /** Over all stores, one per currency in the rows; the stores' own currencies, all zero, when there are no rows. */
  totals: ReportTotals[];
  /** Each store's own totals. */
  perStore: { storeId: string; storeSlug: string; storeName: string; totals: ReportTotals[] }[];
  totalMinutes: number;
  totalBillableMinutes: number;
  /** The stores' clocks gave them different days for a preset (stores in different time zones near a boundary). */
  periodsDiffer: boolean;
};

const FIGURE_KEYS: (keyof ReportFigures)[] = [
  "minutes",
  "billableMinutes",
  "unbilledMinutes",
  "unbilledMinor",
  "draftMinor",
  "invoicedMinor",
  "creditedMinor",
  "netInvoicedMinor",
  "netInvoicedInclMinor",
  "paidMinor",
  "outstandingMinor",
];

function zeroFigures(): ReportFigures {
  return Object.fromEntries(FIGURE_KEYS.map((key) => [key, 0])) as ReportFigures;
}

/**
 * Several stores' period reports as one. Rows stay each store's own (a client is one store's, and its figures
 * are in its own currency); the totals add the rows' figures per currency, so two stores in NOK give one NOK
 * total and a store in SEK its own. With no rows at all the totals are zero in each store's main currency.
 */
export function mergeReports(
  parts: readonly { store: Pick<WorkStore, "id" | "slug" | "name">; report: PeriodReport }[],
): OwnerReport {
  const rows: OwnerReportRow[] = [];
  for (const { store, report } of parts) {
    for (const row of report.rows) rows.push({ ...row, storeId: store.id, storeSlug: store.slug, storeName: store.name });
  }
  const sum = (currency: string, items: readonly ReportFigures[]): ReportTotals => {
    const total = { ...zeroFigures(), currency } as ReportTotals;
    for (const item of items) for (const key of FIGURE_KEYS) total[key] = add(total[key], item[key]);
    return total;
  };
  const currencies = [...new Set(rows.map((r) => r.currency))].sort();
  const totals = rows.length
    ? currencies.map((currency) =>
        sum(
          currency,
          rows.filter((r) => r.currency === currency),
        ),
      )
    : figuresTotalsOfEmpty(parts.map((p) => p.report));
  const head = parts[0]?.report;
  return {
    from: head?.from ?? "",
    to: head?.to ?? "",
    by: head?.by ?? "client",
    rows,
    totals,
    perStore: parts.map(({ store, report }) => ({
      storeId: store.id,
      storeSlug: store.slug,
      storeName: store.name,
      totals: report.totals,
    })),
    totalMinutes: parts.reduce((s, p) => add(s, p.report.totalMinutes), 0),
    totalBillableMinutes: parts.reduce((s, p) => add(s, p.report.totalBillableMinutes), 0),
    periodsDiffer: parts.some((p) => p.report.from !== head?.from || p.report.to !== head?.to),
  };
}

/** Each empty report already carries zero totals in its store's main currency; the distinct ones, in order. */
function figuresTotalsOfEmpty(reports: readonly PeriodReport[]): ReportTotals[] {
  const seen = new Map<string, ReportTotals>();
  for (const report of reports) for (const total of report.totals) if (!seen.has(total.currency)) seen.set(total.currency, total);
  return [...seen.values()].sort((a, b) => (a.currency < b.currency ? -1 : 1));
}

/**
 * The report's settings from the address, for each store: the same period presets and parameters as one store's
 * report (`parseReportParams`), a preset worked out on each store's own day (a store's month is its own). A client
 * belongs to one store, so the combined report has no client filter (the store's own report has). `head` is what
 * the page shows, from the first store; the stores agree unless their clocks are on either side of midnight.
 */
export function parseOwnerReportParams(
  query: Params,
  stores: readonly Pick<WorkStore, "id" | "timeZone">[],
  now: Date | number = new Date(),
): { head: ReportParams; byStore: Map<string, ReportParams> } {
  const each = stores.map((store) => ({
    id: store.id,
    params: { ...parseReportParams(query, todayIn(store.timeZone, now)), clientId: "" },
  }));
  return {
    head: each[0]?.params ?? { ...parseReportParams(query, todayIn("UTC", now)), clientId: "" },
    byStore: new Map(each.map((e) => [e.id, e.params])),
  };
}

export const isEmptyOwnerReport = (report: OwnerReport): boolean => report.rows.length === 0;

const hoursOf = (minutes: number): string => hundredthsToDecimal(minutesToHundredths(minutes));

/**
 * The combined report as a spreadsheet file: the store first, then the client (and assignment), plain
 * decimals, and a total row per currency. Text goes through `toCsv()`, so a store or client called
 * `=HYPERLINK(...)` is written as plain text.
 */
export function ownerReportToCsv(report: OwnerReport): string {
  const head = [
    "Store",
    "Client",
    "Assignment",
    "Billing type",
    "Currency",
    "Hours",
    "Billable hours",
    "Unbilled hours",
    "Unbilled value excl. VAT",
    "Not yet invoiced (drafts) excl. VAT",
    "Invoiced excl. VAT",
    "Credited excl. VAT",
    "Net invoiced excl. VAT",
    "Net invoiced incl. VAT",
    "Paid incl. VAT",
    "Outstanding incl. VAT",
  ];
  const cells = (f: ReportFigures, currency: string) => {
    const m = (minor: number) => minorToDecimal(minor, currency);
    return [
      hoursOf(f.minutes),
      hoursOf(f.billableMinutes),
      hoursOf(f.unbilledMinutes),
      m(f.unbilledMinor),
      m(f.draftMinor),
      m(f.invoicedMinor),
      m(f.creditedMinor),
      m(f.netInvoicedMinor),
      m(f.netInvoicedInclMinor),
      m(f.paidMinor),
      m(f.outstandingMinor),
    ];
  };
  const rows: (string | number | null)[][] = [
    ["Report", "Work report, all stores"],
    ["From", report.from],
    ["To", report.to],
    ["Grouped by", report.by],
    [],
    head,
  ];
  for (const r of report.rows) {
    rows.push([
      r.storeName,
      r.clientName,
      report.by === "assignment" ? rowLabel(r, "assignment") : "",
      r.billingType ?? "",
      r.currency,
      ...cells(r, r.currency),
    ]);
  }
  rows.push([]);
  for (const t of report.totals) rows.push(["Total", "", "", "", t.currency, ...cells(t, t.currency)]);
  return buildCsv(rows);
}

/** `work-report-all-stores-2026-09-01-2026-09-30.csv`, or the store's slug when the report is of one store. */
export const ownerReportFileName = (report: Pick<OwnerReport, "from" | "to" | "by">, storeSlug: string): string =>
  csvFileName("work-report", storeSlug || "all-stores", report.by, report.from, report.to);

// --- Settings ----------------------------------------------------------------------------------------------

/** What the settings page says about turning Work off: it hides, and nothing is lost. */
export function switchOffNote(counts: { issuedInvoices: number; runningTimers: number }): string {
  const parts: string[] = [];
  if (counts.issuedInvoices > 0)
    parts.push(`${counts.issuedInvoices} issued ${counts.issuedInvoices === 1 ? "invoice" : "invoices"}`);
  if (counts.runningTimers > 0)
    parts.push(`${counts.runningTimers} running ${counts.runningTimers === 1 ? "timer" : "timers"}`);
  const keeps = parts.length ? ` It has ${parts.join(" and ")}.` : "";
  return `Turning Work off hides it here and in the store. Everything you saved is kept, and turning it on again brings it back.${keeps}`;
}
