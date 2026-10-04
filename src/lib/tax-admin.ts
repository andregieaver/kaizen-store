/**
 * What the VAT, OSS and IOSS page of the admin reads from its address and from its export forms (D161, `docs/wave-1c-reports.md` 2.2). Pure:
 * nothing reads the clock (callers pass `today`, a store day) or the database. The address is data a person can type, so every value is
 * checked here and falls back to a default; nothing from it is ever written into the page as text (the sentences below are fixed).
 *
 * These are the owner's own figures for the owner's accountant. They are not a tax return and Kaizen files nothing.
 */
import { addDays, daysBetween, isDay, MAX_PERIOD_DAYS } from "./analytics-period";
import type { ReturnMode, ReturnScheme } from "./oss-return";
import { lastCompletedMonth, lastCompletedQuarter, monthPeriod, parseMonthKey, parseQuarterKey, periodLabel, quarterOfDay, quarterPeriod, shiftPeriod, type TaxPeriod } from "./tax-periods";

export const TAX_VIEWS = ["vat", "oss", "ioss"] as const;
export type TaxViewId = (typeof TAX_VIEWS)[number];

export const TAX_VIEW_LABEL: Record<TaxViewId, string> = { vat: "VAT by country and rate", oss: "OSS return data", ioss: "IOSS return data" };

/** The first quarter of the Union scheme (1 July 2021): nothing earlier is a return period. */
const FIRST_QUARTER = quarterPeriod(2021, 3);
const FIRST_MONTH = monthPeriod(2021, 7);

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export type TaxQuery = {
  view: TaxViewId;
  quarter: TaxPeriod;
  month: TaxPeriod;
  mode: ReturnMode;
};

/**
 * The view the address asks for. The default quarter and month are the last that have ended; a period that has not begun, or that is
 * before the schemes began, is the default. An open (still running) quarter is allowed: the page says it is in progress.
 */
export function parseTaxQuery(query: Record<string, string | string[] | undefined>, today: string): TaxQuery {
  const rawView = first(query.view);
  const view = (TAX_VIEWS as readonly string[]).includes(rawView ?? "") ? (rawView as TaxViewId) : "vat";
  const usable = (period: TaxPeriod | null, earliest: TaxPeriod): period is TaxPeriod => period !== null && period.from <= today && period.from >= earliest.from;
  const asked = parseQuarterKey(first(query.quarter));
  const askedMonth = parseMonthKey(first(query.month));
  return {
    view,
    quarter: usable(asked, FIRST_QUARTER) ? asked : lastCompletedQuarter(today),
    month: usable(askedMonth, FIRST_MONTH) ? askedMonth : lastCompletedMonth(today),
    mode: first(query.mode) === "books" ? "books" : "filing",
  };
}

/** The periods the picker offers, newest first: the running one and the last eleven quarters, or the running month and the last 23. */
export function periodOptions(kind: TaxPeriod["kind"], today: string): { key: string; label: string }[] {
  const current = kind === "quarter" ? quarterOfDay(today) : monthPeriod(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const floor = kind === "quarter" ? FIRST_QUARTER : FIRST_MONTH;
  const count = kind === "quarter" ? 12 : 24;
  const options: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const period = shiftPeriod(current, -i);
    if (period.from < floor.from) break;
    options.push({ key: period.key, label: periodLabel(period) });
  }
  return options;
}

/** The page's address for a view, keeping what the person chose (a custom range of the VAT view is added by the caller). */
export function taxHref(base: string, state: { view: TaxViewId; quarter?: string; month?: string; mode?: ReturnMode }, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  if (state.view !== "vat") q.set("view", state.view);
  if (state.view === "oss" && state.quarter) q.set("quarter", state.quarter);
  if (state.view === "ioss" && state.month) q.set("month", state.month);
  if (state.view !== "vat" && state.mode && state.mode !== "filing") q.set("mode", state.mode);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const text = q.toString();
  return `${base}/analytics/tax${text ? `?${text}` : ""}`;
}

// ---------------------------------------------------------------------------
// Exports: what the form posts and what the page says when the route sent the person back
// ---------------------------------------------------------------------------

/** What the export route sent the person back with (`?export=`): fixed sentences, never text from the address. */
export const EXPORT_PROBLEMS = {
  period: "Choose a period: a first and a last day, the first not after the last, at most 800 days.",
  incomplete: "The return data was not exported: it is incomplete. A euro rate is missing for a currency, so the figures would not be whole. Fetch the ECB's rate or enter your own under Euro rates, then export again. The conversion detail can still be exported: it shows the gap.",
  forbidden: "Exports need the analytics role with write access.",
  failed: "The export could not be written to the log, so no file was made. Try again.",
} as const;
export type ExportProblem = keyof typeof EXPORT_PROBLEMS;

export const exportProblemOf = (value: string | string[] | undefined): string | null => {
  const text = first(value);
  return text && Object.hasOwn(EXPORT_PROBLEMS, text) ? EXPORT_PROBLEMS[text as ExportProblem] : null;
};

export const EXPORT_KINDS = ["vat", "reconciliation", "oss", "oss_detail", "ioss", "ioss_detail"] as const;
export type ExportFormKind = (typeof EXPORT_KINDS)[number];

export type ExportRequest =
  | { ok: true; kind: "vat" | "reconciliation"; range: { from: string; to: string }; last: string }
  | { ok: true; kind: "oss" | "oss_detail" | "ioss" | "ioss_detail"; scheme: ReturnScheme; period: TaxPeriod; mode: ReturnMode; detail: boolean }
  | { ok: false; problem: "period" };

/**
 * What an export form asked for. A range is two real days, `from` to `last` (the last day included), in order and at most 800 days; a
 * return is a quarter (OSS) or a month (IOSS) in a mode. Anything else is refused as `period`: a form that was not made by the page.
 */
export function parseExportForm(form: { get(name: string): unknown }): ExportRequest {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const kind = text("kind");
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return { ok: false, problem: "period" };
  if (kind === "vat" || kind === "reconciliation") {
    const from = text("from");
    const last = text("last");
    if (!isDay(from) || !isDay(last) || from > last || daysBetween(from, last) + 1 > MAX_PERIOD_DAYS) return { ok: false, problem: "period" };
    return { ok: true, kind, range: { from, to: addDays(last, 1) }, last };
  }
  const scheme: ReturnScheme = kind.startsWith("ioss") ? "ioss" : "oss";
  const period = scheme === "oss" ? parseQuarterKey(text("period")) : parseMonthKey(text("period"));
  if (!period) return { ok: false, problem: "period" };
  return { ok: true, kind: kind as "oss" | "oss_detail" | "ioss" | "ioss_detail", scheme, period, mode: text("mode") === "books" ? "books" : "filing", detail: kind.endsWith("_detail") };
}

/** Where the export route sends a person back to, with the problem and the view they were on. */
export function exportBackHref(base: string, request: ExportRequest, problem: ExportProblem): string {
  if (request.ok && "scheme" in request) {
    return taxHref(base, { view: request.scheme, quarter: request.scheme === "oss" ? request.period.key : undefined, month: request.scheme === "ioss" ? request.period.key : undefined, mode: request.mode }, { export: problem });
  }
  if (request.ok) return taxHref(base, { view: "vat" }, { period: "custom", from: request.range.from, to: request.last, export: problem });
  return taxHref(base, { view: "vat" }, { export: problem });
}
