import {
  effectiveRate,
  hundredthsToDecimal,
  minorToDecimal,
  minutesToHundredths,
  timeAmountMinor,
  type BillingType,
} from "./work-calc";
import { buildCsv, csvFileName } from "./work-csv";
import { addCalendarDays, addMonthsClamped, daysBetween, isDay, startOfMonth, type Day } from "./work-dates";

/**
 * Work's reports (docs/work.md 1.9, 7.2 WP9): for a period, per client or per
 * assignment, the hours logged, the value of time not yet invoiced, what is in
 * drafts, what was invoiced (net of credit notes), what has been paid and what
 * is still owed. Pure: the server reads plain rows (`src/server/work-reports.ts`),
 * this decides what they mean, and nothing is ever summed in the browser.
 *
 * What counts, and when:
 *
 *  - Hours are the time entries whose work date is in the period.
 *  - Unbilled value is the billable time in the period that no invoice line
 *    has taken, at the assignment's rate (as the overview prices it). A fixed
 *    fee has no hourly value, so it has none.
 *  - Only ISSUED invoices count as invoiced, by the day they were issued. An
 *    invoice is therefore in exactly one period, and a **fixed fee is counted
 *    once, in the period it is invoiced** (Life added the whole fee to every
 *    period it showed). Drafts are shown apart, as "not yet invoiced", by the
 *    day they were made.
 *  - Credit notes, payments and what is outstanding follow the invoices of the
 *    period ("of what was invoiced in these months, so much is credited, paid
 *    and owed today"), so the columns add up: invoiced less credited, less
 *    paid, is outstanding. Amounts of invoices and credit notes are without
 *    VAT; payments and what is owed have VAT, as the money does.
 *  - A day is a day in the store's time zone (issue dates and work dates are
 *    days, not instants), and a period is inclusive at both ends.
 *
 * Money is integer minor units, exact (BigInt where it is added or shared),
 * and per currency: amounts of different currencies are never added.
 */

// --- Periods ----------------------------------------------------------------

export const REPORT_PRESETS = ["this_month", "last_month", "quarter", "year", "custom"] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export const PRESET_LABELS: Record<ReportPreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  quarter: "This quarter",
  year: "This year",
  custom: "Custom",
};

export type ReportGroupBy = "client" | "assignment";
export const REPORT_GROUPS: readonly ReportGroupBy[] = ["client", "assignment"];
export const GROUP_LABELS: Record<ReportGroupBy, string> = { client: "By client", assignment: "By assignment" };

/** The longest custom period, in days (five years): a report reads every entry and invoice in it. */
export const MAX_REPORT_DAYS = 1830;

export type ReportPeriod = { preset: ReportPreset; from: Day; to: Day };

const lastDayOfMonthStarting = (start: Day, months: number): Day => addCalendarDays(addMonthsClamped(start, months), -1);

/** A preset's days for a store's today: whole months, quarters and years, ending on their last day (not on today). */
export function presetPeriod(preset: Exclude<ReportPreset, "custom">, today: Day): { from: Day; to: Day } {
  const month = startOfMonth(today);
  switch (preset) {
    case "this_month":
      return { from: month, to: lastDayOfMonthStarting(month, 1) };
    case "last_month": {
      const from = addMonthsClamped(month, -1);
      return { from, to: addCalendarDays(month, -1) };
    }
    case "quarter": {
      const m = Number(today.slice(5, 7));
      const from = `${today.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
      return { from, to: lastDayOfMonthStarting(from, 3) };
    }
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}

export type ReportParams = {
  period: ReportPeriod;
  by: ReportGroupBy;
  /** One client's rows only; empty for all. */
  clientId: string;
  /** Why the address was not used as it stood (a custom period that is wrong), for a notice. */
  problem: string | null;
};

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The report's settings from the address (`?period=last_month&by=assignment&client=...`, or
 * `?period=custom&from=2026-01-01&to=2026-03-31`). Anything unreadable falls back to this month,
 * by client, all clients; a custom period that cannot be used says why in `problem`.
 */
export function parseReportParams(params: Params, today: Day): ReportParams {
  const by: ReportGroupBy = first(params.by) === "assignment" ? "assignment" : "client";
  const clientId = UUID.test(first(params.client)) ? first(params.client).toLowerCase() : "";
  const asked = first(params.period);
  const fallback = (problem: string | null): ReportParams => ({
    period: { preset: "this_month", ...presetPeriod("this_month", today) },
    by,
    clientId,
    problem,
  });
  const preset = (REPORT_PRESETS as readonly string[]).includes(asked) ? (asked as ReportPreset) : null;
  if (preset === null) {
    // A bare from/to without a period is a custom one.
    if (!first(params.from) && !first(params.to)) return fallback(null);
  }
  if (preset !== null && preset !== "custom") {
    return { period: { preset, ...presetPeriod(preset, today) }, by, clientId, problem: null };
  }
  const from = first(params.from);
  const to = first(params.to);
  if (!isDay(from) || !isDay(to)) return fallback("Choose a first and a last day for the report.");
  if (from > to) return fallback("The first day is after the last day.");
  if (daysBetween(from, to) + 1 > MAX_REPORT_DAYS) return fallback("A report can cover at most five years.");
  return { period: { preset: "custom", from, to }, by, clientId, problem: null };
}

/** The address's query for settings (a preset carries no dates, so "this month" stays this month). */
export function reportQuery(
  params: Pick<ReportParams, "period" | "by" | "clientId">,
  extra: Record<string, string> = {},
): string {
  const q = new URLSearchParams();
  q.set("period", params.period.preset);
  if (params.period.preset === "custom") {
    q.set("from", params.period.from);
    q.set("to", params.period.to);
  }
  if (params.by !== "client") q.set("by", params.by);
  if (params.clientId) q.set("client", params.clientId);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `?${q.toString()}`;
}

/** The period in words for a heading: "1 Sep - 30 Sep 2026" is the caller's; this is the plain "2026-09-01 to 2026-09-30". */
export const periodText = (period: Pick<ReportPeriod, "from" | "to">): string =>
  period.from === period.to ? period.from : `${period.from} to ${period.to}`;

// --- Sharing an amount --------------------------------------------------------

/**
 * `total` shared over `weights`, in whole minor units, exactly: each gets its proportional part rounded
 * down and what is left over goes one unit at a time to the biggest fractions (the earlier first), so
 * the parts always add up to the total. All-zero weights share it equally. Used to say how much of an
 * invoice's payment belongs to each assignment on it.
 */
export function allocateMinor(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (!Number.isSafeInteger(total)) throw new RangeError(`Amount must be a whole number: ${total}`);
  const sign = total < 0 ? BigInt(-1) : BigInt(1);
  const amount = BigInt(total) * sign;
  const w = weights.map((x) => {
    if (!Number.isSafeInteger(x) || x < 0) throw new RangeError(`Weights must be whole numbers, not negative: ${x}`);
    return BigInt(x);
  });
  const sumW = w.reduce((a, b) => a + b, BigInt(0));
  const shares = sumW === BigInt(0) ? w.map(() => BigInt(1)) : w;
  const denominator = sumW === BigInt(0) ? BigInt(n) : sumW;
  const base = shares.map((s) => (amount * s) / denominator);
  const rest = shares.map((s) => (amount * s) % denominator);
  let left = amount - base.reduce((a, b) => a + b, BigInt(0));
  const order = rest.map((r, i) => ({ r, i })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of order) {
    if (left <= BigInt(0)) break;
    base[i] += BigInt(1);
    left -= BigInt(1);
  }
  return base.map((b) => Number(b * sign));
}

const toSafe = (value: bigint, name: string): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${name} is too large to count exactly`);
  }
  return Number(value);
};

// --- Input rows ---------------------------------------------------------------

export type ReportClient = { id: string; name: string; currency: string; defaultHourlyRateMinor: number | null };

export type ReportAssignment = {
  id: string;
  clientId: string;
  name: string;
  billingType: BillingType;
  hourlyRateMinor: number | null;
};

export type ReportEntry = {
  assignmentId: string;
  workDate: Day;
  minutes: number;
  billable: boolean;
  prepaidMinutes: number;
  /** Set once a draft or issued invoice line has taken the entry. */
  invoiceLineId: string | null;
};

export type ReportInvoiceLine = { lineId: string; assignmentId: string | null; exclMinor: number; inclMinor: number };

/** What a credit note took back of one invoice line (its lines' `line_id`, `excl_minor`, `incl_minor`). */
export type ReportCredit = { lineId: string; exclMinor: number; inclMinor: number };

/** An issued invoice (sent, paid or void), with what has been credited and paid on it so far. */
export type ReportInvoice = {
  id: string;
  clientId: string;
  currency: string;
  issuedOn: Day;
  /** Payments received less refunds and reversals. */
  paidMinor: number;
  lines: readonly ReportInvoiceLine[];
  credits: readonly ReportCredit[];
};

export type ReportDraft = {
  id: string;
  clientId: string;
  currency: string;
  /** The day the draft was made, in the store's time zone. */
  createdOn: Day;
  lines: readonly { assignmentId: string | null; exclMinor: number }[];
};

export type ReportInput = {
  from: Day;
  to: Day;
  by: ReportGroupBy;
  /** A currency to show zero totals in when the report has no rows (`mainCurrency(store)`), never a guess. */
  fallbackCurrency: string;
  clients: readonly ReportClient[];
  assignments: readonly ReportAssignment[];
  entries: readonly ReportEntry[];
  invoices: readonly ReportInvoice[];
  drafts: readonly ReportDraft[];
};

// --- The report -----------------------------------------------------------------

export type ReportFigures = {
  /** All logged minutes, billable or not. */
  minutes: number;
  billableMinutes: number;
  /** Billable minutes no invoice line has taken, less prepaid ones. */
  unbilledMinutes: number;
  /** Net, at the rates. */
  unbilledMinor: number;
  /** Drafts made in the period, without VAT. */
  draftMinor: number;
  /** Lines of invoices issued in the period, without VAT. */
  invoicedMinor: number;
  /** Credit notes against those invoices, without VAT. */
  creditedMinor: number;
  /** Invoiced less credited, without VAT: the revenue. */
  netInvoicedMinor: number;
  /** The same with VAT. */
  netInvoicedInclMinor: number;
  /** Payments on those invoices, with VAT. */
  paidMinor: number;
  /** Still owed on them, with VAT. */
  outstandingMinor: number;
};

export type ReportRow = ReportFigures & {
  key: string;
  clientId: string;
  clientName: string;
  assignmentId: string | null;
  /** Null when grouped by client, and for invoice lines that name no assignment. */
  assignmentName: string | null;
  billingType: BillingType | null;
  currency: string;
};

export type ReportTotals = ReportFigures & { currency: string };

export type PeriodReport = {
  from: Day;
  to: Day;
  by: ReportGroupBy;
  rows: ReportRow[];
  /** One per currency in the rows, in currency order; the fallback currency, all zero, when there are none. */
  totals: ReportTotals[];
  /** Hours over all rows, whatever their currency. */
  totalMinutes: number;
  totalBillableMinutes: number;
};

const ZERO = BigInt(0);
type Acc = Record<keyof ReportFigures, bigint>;
const zero = (): Acc => ({
  minutes: ZERO,
  billableMinutes: ZERO,
  unbilledMinutes: ZERO,
  unbilledMinor: ZERO,
  draftMinor: ZERO,
  invoicedMinor: ZERO,
  creditedMinor: ZERO,
  netInvoicedMinor: ZERO,
  netInvoicedInclMinor: ZERO,
  paidMinor: ZERO,
  outstandingMinor: ZERO,
});
const FIGURES = Object.keys(zero()) as (keyof ReportFigures)[];

const figuresOf = (acc: Acc, name: string): ReportFigures => {
  const out = {} as ReportFigures;
  for (const key of FIGURES) out[key] = toSafe(acc[key], `${name} (${key})`);
  return out;
};

const inPeriod = (day: Day, from: Day, to: Day) => day >= from && day <= to;
const big = (n: number) => BigInt(n);

/**
 * The report for a period. Rows are per client (with its currency) or per assignment, sorted by client
 * name then assignment name, and only what has something in the period: hours, a draft, an issued
 * invoice line. An invoice line that names no assignment is its own row in an assignment report
 * (`assignmentId` null). A client's time is in the client's currency, an invoice in its own, so a
 * client billed in two currencies has a row for each.
 */
export function buildPeriodReport(input: ReportInput): PeriodReport {
  const clientsById = new Map(input.clients.map((c) => [c.id, c]));
  const assignmentsById = new Map(input.assignments.map((a) => [a.id, a]));
  const rows = new Map<string, { row: Omit<ReportRow, keyof ReportFigures>; acc: Acc }>();

  const bucket = (clientId: string, assignmentId: string | null, currency: string) => {
    const assignment = input.by === "assignment" ? assignmentId : null;
    const key = `${clientId}|${assignment ?? ""}|${currency}`;
    let entry = rows.get(key);
    if (!entry) {
      const a = assignment ? assignmentsById.get(assignment) : undefined;
      entry = {
        row: {
          key,
          clientId,
          clientName: clientsById.get(clientId)?.name ?? "",
          assignmentId: assignment,
          assignmentName: a?.name ?? null,
          billingType: a?.billingType ?? null,
          currency,
        },
        acc: zero(),
      };
      rows.set(key, entry);
    }
    return entry.acc;
  };

  // Hours and unbilled time, per assignment first (the hours are rounded once per assignment, as a line would be).
  const perAssignment = new Map<string, { minutes: number; billable: number; unbilled: number }>();
  for (const e of input.entries) {
    if (!inPeriod(e.workDate, input.from, input.to)) continue;
    const a = assignmentsById.get(e.assignmentId);
    if (!a) continue;
    const t = perAssignment.get(a.id) ?? { minutes: 0, billable: 0, unbilled: 0 };
    t.minutes += e.minutes;
    if (e.billable) {
      t.billable += e.minutes;
      if (!e.invoiceLineId) t.unbilled += Math.max(0, e.minutes - e.prepaidMinutes);
    }
    perAssignment.set(a.id, t);
  }
  for (const [assignmentId, t] of perAssignment) {
    const a = assignmentsById.get(assignmentId)!;
    const client = clientsById.get(a.clientId);
    if (!client) continue;
    const acc = bucket(a.clientId, a.id, client.currency);
    acc.minutes += big(t.minutes);
    acc.billableMinutes += big(t.billable);
    // A fixed fee has no hourly value: it is invoiced, and counted, once (in the period of its invoice).
    if (a.billingType === "hourly" && t.unbilled > 0) {
      const { rateMinor } = effectiveRate(a, client);
      acc.unbilledMinutes += big(t.unbilled);
      acc.unbilledMinor += big(timeAmountMinor(t.unbilled, rateMinor));
    } else if (t.unbilled > 0) {
      acc.unbilledMinutes += big(t.unbilled);
    }
  }

  // Issued invoices, credited and paid.
  for (const inv of input.invoices) {
    if (!inPeriod(inv.issuedOn, input.from, input.to)) continue;
    const groups = new Map<string | null, { excl: bigint; incl: bigint; creditExcl: bigint; creditIncl: bigint }>();
    const group = (assignmentId: string | null) => {
      let g = groups.get(assignmentId);
      if (!g) groups.set(assignmentId, (g = { excl: ZERO, incl: ZERO, creditExcl: ZERO, creditIncl: ZERO }));
      return g;
    };
    const assignmentOfLine = new Map<string, string | null>();
    for (const l of inv.lines) {
      assignmentOfLine.set(l.lineId, l.assignmentId);
      const g = group(l.assignmentId);
      g.excl += big(l.exclMinor);
      g.incl += big(l.inclMinor);
    }
    for (const c of inv.credits) {
      const g = group(assignmentOfLine.get(c.lineId) ?? null);
      g.creditExcl += big(c.exclMinor);
      g.creditIncl += big(c.inclMinor);
    }
    const ids = [...groups.keys()];
    if (ids.length === 0) continue;
    const netIncl = ids.map((id) => {
      const g = groups.get(id)!;
      return g.incl > g.creditIncl ? toSafe(g.incl - g.creditIncl, "Invoice") : 0;
    });
    const owed = netIncl.reduce((s, n) => s + n, 0);
    const paid = inv.paidMinor;
    const paidParts = allocateMinor(paid, netIncl.some((n) => n > 0) ? netIncl : ids.map((id) => toSafe(groups.get(id)!.incl, "Invoice")));
    const outstandingParts = allocateMinor(Math.max(0, owed - paid), netIncl);
    ids.forEach((id, i) => {
      const g = groups.get(id)!;
      const acc = bucket(inv.clientId, id, inv.currency);
      acc.invoicedMinor += g.excl;
      acc.creditedMinor += g.creditExcl;
      acc.netInvoicedMinor += g.excl - g.creditExcl;
      acc.netInvoicedInclMinor += g.incl - g.creditIncl;
      acc.paidMinor += big(paidParts[i]);
      acc.outstandingMinor += big(outstandingParts[i]);
    });
  }

  // Drafts, apart: what has been made ready and not issued.
  for (const d of input.drafts) {
    if (!inPeriod(d.createdOn, input.from, input.to)) continue;
    for (const l of d.lines) {
      bucket(d.clientId, l.assignmentId, d.currency).draftMinor += big(l.exclMinor);
    }
  }

  const list: ReportRow[] = [...rows.values()].map(({ row, acc }) => ({ ...row, ...figuresOf(acc, row.clientName) }));
  list.sort(
    (a, b) =>
      a.clientName.localeCompare(b.clientName) ||
      (a.assignmentName ?? "").localeCompare(b.assignmentName ?? "") ||
      a.currency.localeCompare(b.currency) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );

  const byCurrency = new Map<string, Acc>();
  let totalMinutes = ZERO;
  let totalBillable = ZERO;
  for (const { row, acc } of rows.values()) {
    const t = byCurrency.get(row.currency) ?? zero();
    for (const key of FIGURES) t[key] += acc[key];
    byCurrency.set(row.currency, t);
    totalMinutes += acc.minutes;
    totalBillable += acc.billableMinutes;
  }
  const totals: ReportTotals[] = [...byCurrency.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, acc]) => ({ currency, ...figuresOf(acc, "Total") }));
  if (totals.length === 0) totals.push({ currency: input.fallbackCurrency, ...figuresOf(zero(), "Total") });

  return {
    from: input.from,
    to: input.to,
    by: input.by,
    rows: list,
    totals,
    totalMinutes: toSafe(totalMinutes, "Hours"),
    totalBillableMinutes: toSafe(totalBillable, "Billable hours"),
  };
}

/** Whether the report has anything in it. */
export const isEmptyReport = (report: PeriodReport): boolean => report.rows.length === 0;

/** What a row is called: the client, then the assignment when grouped by it. */
export const rowLabel = (row: Pick<ReportRow, "clientName" | "assignmentId" | "assignmentName">, by: ReportGroupBy): string =>
  by === "client" ? row.clientName : row.assignmentName ?? (row.assignmentId ? "Assignment" : "Other lines (no assignment)");

// --- CSV ------------------------------------------------------------------------

const hoursOf = (minutes: number): string => hundredthsToDecimal(minutesToHundredths(minutes));

/**
 * The report as a spreadsheet file: a header block, one row per row with plain decimals (`1234.50`,
 * hours as `12.50`), and a total row per currency. Text goes through `toCsv()`, so a client called
 * `=HYPERLINK(...)` is written as plain text.
 */
export function periodReportToCsv(report: PeriodReport): string {
  const head = [
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
    ["Report", "Work report"],
    ["From", report.from],
    ["To", report.to],
    ["Grouped by", report.by],
    [],
    head,
  ];
  for (const r of report.rows) {
    rows.push([
      r.clientName,
      report.by === "assignment" ? rowLabel(r, "assignment") : "",
      r.billingType ?? "",
      r.currency,
      ...cells(r, r.currency),
    ]);
  }
  rows.push([]);
  for (const t of report.totals) rows.push(["Total", "", "", t.currency, ...cells(t, t.currency)]);
  return buildCsv(rows);
}

/** The download's file name: `work-report-kaffe-2026-09-01-2026-09-30.csv`. */
export const reportFileName = (storeSlug: string, report: Pick<PeriodReport, "from" | "to" | "by">): string =>
  csvFileName("work-report", storeSlug, report.by, report.from, report.to);
