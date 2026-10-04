import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { formatMoney } from "@/lib/money";
import type { ReturnData, ReturnMode, ReturnScheme } from "@/lib/oss-return";
import { longDate, rangeKey, type TaxPeriod } from "@/lib/tax-periods";
import { reconciliationCsv, reconciliationFileName, returnCsv, returnFileName, detailCsv, vatCsv, vatFileName } from "@/lib/tax-csv";
import type { VatReport } from "@/lib/tax-report";

import { audit, type Membership } from "./auth";
import { memberCan } from "./permissions";
import { reconciliation, type ReconciliationView } from "./tax-reconciliation";
import { returnView, vatReport, type TaxRange } from "./tax-reports";

type Row = Record<string, unknown>;

/**
 * Exporting the VAT, OSS and IOSS reports as files, and remembering what was exported (D161, `docs/wave-1c-reports.md` 2.2.2, 3.2 and 4.8).
 * Every export needs `analytics:write`, is formula-safe and logged twice: in `commerce.tax_report_exports` with its aggregate totals (no
 * buyer, no document number: only the sums) and in the activity log (`analytics.tax_report_exported`: period, view, mode, row count,
 * never the amounts). The log is written BEFORE the file is handed back, and if it cannot be written the file is not served, because an
 * export that is not logged would defeat the drift line: when a period's figures change after an export, the view says so, as advice and
 * never a block. An incomplete return (a currency with no euro rate) is never exported as complete: its Return data is refused with the
 * reason, while its Conversion detail, which shows the gap, is allowed.
 *
 * THE FILES ARE THE OWNER'S OWN DATA FOR THE OWNER'S ACCOUNTANT. They are not a tax return and Kaizen files nothing.
 */

export type ExportKind = "vat" | "oss" | "oss_detail" | "ioss" | "ioss_detail" | "reconciliation";

/** The aggregate numbers an export keeps: nothing a person could be found from. */
export type ExportTotals = {
  currency: string;
  /** The figure the drift line compares: VAT after credits for the VAT report, Part 2 VAT for a return, the report's VAT charged for a reconciliation. Null when it could not be worked out. */
  vatMinor: number | null;
  taxableMinor: number | null;
  documents: number;
  creditNotes: number;
  incomplete: boolean;
};

export type ExportResult =
  | { ok: true; filename: string; csv: string; rows: number }
  | { ok: false; reason: "forbidden" | "incomplete" | "failed"; message: string };

const FORBIDDEN: ExportResult = { ok: false, reason: "forbidden", message: "Exports need the analytics role with write access." };
const FAILED: ExportResult = { ok: false, reason: "failed", message: "The export could not be logged, so no file was made. Try again." };

// ---------------------------------------------------------------------------
// The totals of each kind of export
// ---------------------------------------------------------------------------

export function vatTotals(report: VatReport): ExportTotals {
  const left = report.notConverted.invoices + report.notConverted.creditNotes;
  return {
    currency: report.mainCurrency,
    vatMinor: report.totals.vatAfterMainMinor,
    taxableMinor: report.totals.netAfterMainMinor,
    documents: report.totals.invoices,
    creditNotes: report.totals.creditNotes,
    incomplete: left > 0,
  };
}

export function returnTotals(data: ReturnData): ExportTotals {
  return { currency: "EUR", vatMinor: data.totals.vatEur, taxableMinor: data.totals.taxableEur, documents: data.totals.documents, creditNotes: data.totals.creditNotes, incomplete: data.incomplete };
}

export function reconciliationTotals(view: ReconciliationView): ExportTotals {
  return {
    currency: view.main.currency,
    vatMinor: view.main.reportMainMinor,
    taxableMinor: null,
    documents: view.bridges.reduce((n, b) => n + b.lines.filter((l) => l.kind === "report").reduce((m, l) => m + l.orders, 0), 0),
    creditNotes: 0,
    incomplete: !view.balanced,
  };
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

export type LoggedExport = {
  id: string;
  report: ExportKind;
  scheme: "union" | "non_union" | "ioss" | null;
  periodKey: string;
  mode: ReturnMode | null;
  rows: number;
  totals: ExportTotals;
  exportedAt: string;
};

type Entry = { report: ExportKind; scheme: "union" | "non_union" | "ioss" | null; periodKey: string; mode: ReturnMode | null; rows: number; totals: ExportTotals };

/** Writes the export's row and its activity-log entry; throws when either cannot be written (the caller then serves no file). */
async function logExport(membership: Membership, entry: Entry): Promise<void> {
  const storeId = membership.store.id;
  await db().execute(sql`
    insert into commerce.tax_report_exports (store_id, report, scheme, period_key, mode, rows, totals, exported_by)
    values (${storeId}::uuid, ${entry.report}, ${entry.scheme}, ${entry.periodKey}, ${entry.mode}, ${entry.rows}, ${JSON.stringify(entry.totals)}::jsonb, ${membership.account.id}::uuid)
  `);
  await audit(membership.account.id, storeId, "analytics.tax_report_exported", { view: entry.report, period: entry.periodKey, mode: entry.mode, rows: entry.rows });
}

const toLogged = (r: Row): LoggedExport => ({
  id: String(r.id),
  report: String(r.report) as ExportKind,
  scheme: r.scheme === null || r.scheme === undefined ? null : (String(r.scheme) as LoggedExport["scheme"]),
  periodKey: String(r.period_key),
  mode: r.mode === null || r.mode === undefined ? null : (String(r.mode) as ReturnMode),
  rows: Number(r.rows),
  totals: r.totals as ExportTotals,
  exportedAt: new Date(String(r.exported_at)).toISOString(),
});

/** The latest export of a report for a period (and mode, for a return); null when there is none. Every query of the log carries the store id. */
export async function lastExport(storeId: string, report: ExportKind, periodKey: string, mode: ReturnMode | null = null): Promise<LoggedExport | null> {
  const [row] = await db().execute<Row>(sql`
    select id, report, scheme, period_key, mode, rows, totals, exported_at
    from commerce.tax_report_exports
    where store_id = ${storeId}::uuid and report = ${report} and period_key = ${periodKey} and mode is not distinct from ${mode}
    order by exported_at desc, id desc limit 1
  `);
  return row ? toLogged(row) : null;
}

/** The export log of a store, newest first, for a period when given. */
export async function exportsOf(storeId: string, opts: { periodKey?: string; limit?: number } = {}): Promise<LoggedExport[]> {
  const rows = await db().execute<Row>(sql`
    select id, report, scheme, period_key, mode, rows, totals, exported_at
    from commerce.tax_report_exports
    where store_id = ${storeId}::uuid ${opts.periodKey ? sql`and period_key = ${opts.periodKey}` : sql``}
    order by exported_at desc, id desc limit ${opts.limit ?? 50}
  `);
  return rows.map(toLogged);
}

/**
 * For the attention item ("your OSS data for Q3 2026 has not been exported"): of several stores at once, the periods whose Return data was
 * exported in filing mode, as `oss:2026-Q3` or `ioss:2026-09`. A store with none has no entry.
 */
export async function returnExportKeys(storeIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  if (storeIds.length === 0) return found;
  const ids = sql.join(storeIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db().execute<Row>(sql`
    select distinct store_id, report, period_key
    from commerce.tax_report_exports
    where store_id in (${ids}) and report in ('oss', 'ioss') and mode = 'filing'
  `);
  for (const r of rows) {
    const set = found.get(String(r.store_id)) ?? new Set<string>();
    set.add(`${String(r.report)}:${String(r.period_key)}`);
    found.set(String(r.store_id), set);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Drift: a period that changed after it was exported
// ---------------------------------------------------------------------------

export type Drift = {
  exportedAt: string;
  currency: string;
  previousVatMinor: number;
  currentVatMinor: number;
  /** Current less previous: positive means more VAT now. */
  differenceMinor: number;
};

/** What the period's VAT is now against what it was when last exported; null when nothing was exported, nothing changed or a figure is unknown. Advice, never a block. */
export function driftOf(last: LoggedExport | null, current: ExportTotals): Drift | null {
  if (!last || last.totals.vatMinor === null || current.vatMinor === null || last.totals.currency !== current.currency) return null;
  const difference = current.vatMinor - last.totals.vatMinor;
  if (difference === 0) return null;
  return { exportedAt: last.exportedAt, currency: current.currency, previousVatMinor: last.totals.vatMinor, currentVatMinor: current.vatMinor, differenceMinor: difference };
}

/** The drift line of 2.2.2. */
export function driftSentence(drift: Drift): string {
  const amount = formatMoney(Math.abs(drift.differenceMinor), drift.currency, "en");
  const sign = drift.differenceMinor > 0 ? "+" : "-";
  return `Changed since you exported this on ${longDate(drift.exportedAt.slice(0, 10))}: VAT ${sign}${amount}. If you have already filed it, the difference belongs in your next return as a correction.`;
}

/** The drift of a period against its latest export of that report, or null. */
export async function driftFor(storeId: string, report: ExportKind, periodKey: string, mode: ReturnMode | null, current: ExportTotals): Promise<Drift | null> {
  return driftOf(await lastExport(storeId, report, periodKey, mode), current);
}

// ---------------------------------------------------------------------------
// The exports
// ---------------------------------------------------------------------------

/** The VAT report of a range as a CSV. Needs `analytics:write`. */
export async function exportVatReport(membership: Membership, range: TaxRange): Promise<ExportResult> {
  if (!memberCan(membership, "analytics:write")) return FORBIDDEN;
  const { report } = await vatReport(membership.store, range);
  const csv = vatCsv(report, range);
  const rows = report.rows.length;
  try {
    await logExport(membership, { report: "vat", scheme: null, periodKey: rangeKey(range.from, range.to), mode: null, rows, totals: vatTotals(report) });
  } catch (error) {
    console.error("tax_report.export_log_failed", error instanceof Error ? error.message : error);
    return FAILED;
  }
  return { ok: true, filename: vatFileName(membership.store.slug, range.from, range.to), csv, rows };
}

/**
 * The OSS (a quarter) or IOSS (a month) return data, or with `detail` its conversion detail, as a CSV. Needs `analytics:write`. The return
 * data is refused while a currency has no euro rate; the detail is not, because it shows the gap.
 */
export async function exportReturnData(membership: Membership, scheme: ReturnScheme, period: TaxPeriod, mode: ReturnMode, detail = false): Promise<ExportResult> {
  if (!memberCan(membership, "analytics:write")) return FORBIDDEN;
  const view = await returnView(membership.store, scheme, period, mode);
  const made = detail ? detailCsv(view.data) : returnCsv(view.data);
  if (!made.ok) return { ok: false, reason: "incomplete", message: made.reason };
  const kind: ExportKind = detail ? (`${scheme}_detail` as ExportKind) : scheme;
  const registration = view.data.registration;
  try {
    await logExport(membership, { report: kind, scheme: registration === "none" ? null : registration, periodKey: period.key, mode, rows: made.rows, totals: returnTotals(view.data) });
  } catch (error) {
    console.error("tax_report.export_log_failed", error instanceof Error ? error.message : error);
    return FAILED;
  }
  return { ok: true, filename: returnFileName(membership.store.slug, view.data, detail), csv: made.csv, rows: made.rows };
}

/** The reconciliation of a range as a CSV (each currency's bridge, unconverted). Needs `analytics:write`. */
export async function exportReconciliation(membership: Membership, range: TaxRange): Promise<ExportResult> {
  if (!memberCan(membership, "analytics:write")) return FORBIDDEN;
  const view = await reconciliation(membership.store, range);
  const csv = reconciliationCsv(view.bridges, range);
  const rows = view.bridges.reduce((n, b) => n + b.lines.length, 0);
  try {
    await logExport(membership, { report: "reconciliation", scheme: null, periodKey: rangeKey(range.from, range.to), mode: null, rows, totals: reconciliationTotals(view) });
  } catch (error) {
    console.error("tax_report.export_log_failed", error instanceof Error ? error.message : error);
    return FAILED;
  }
  return { ok: true, filename: reconciliationFileName(membership.store.slug, range.from, range.to), csv, rows };
}
