import "server-only";

import { amountCell, writeCsv, type Cell, type DialectId } from "@/lib/csv";
import { lastDayOf } from "@/lib/analytics-export";
import { METRICS } from "@/lib/report-catalogue";

import { labelOf, type RowLabels } from "./report-labels";
import type { ReportResult } from "./report-query";

/**
 * A report as a CSV (wave 8 unit A, D345): the table as the page shows it, through `writeCsv()` (formula characters escaped). Columns:
 * the period's first and last day, each dimension's label, each figure (amounts as decimals without VAT, with the main currency in
 * `currency`), and where the report compares, `{figure}_previous` with the comparison's days. The rest row is a row like the others, and
 * the totals are the last row, labelled `total`. Header names are the catalogue's keys, fixed.
 */
export function reportCsv(report: ReportResult, labels: RowLabels, dialect: DialectId = "standard"): string {
  const { spec } = report;
  const compared = report.comparison !== null;
  const head: Cell[] = [
    "period_from",
    "period_to",
    ...(compared ? ["previous_from", "previous_to"] : []),
    ...spec.dimensions,
    ...spec.metrics.flatMap((m) => (compared ? [m, `${m}_previous`] : [m])),
    "currency",
  ];
  const value = (metric: (typeof spec.metrics)[number], v: number | null | undefined): Cell =>
    v === null || v === undefined ? null : METRICS[metric].kind === "count" ? v : amountCell(v, report.currency);
  const dates: Cell[] = [
    report.period.from,
    lastDayOf(report.period.to),
    ...(report.comparison ? [report.comparison.from, lastDayOf(report.comparison.to)] : []),
  ];
  const rows: Cell[][] = report.rows.map((row) => [
    ...dates,
    ...spec.dimensions.map((d, i) => labelOf(labels, d, row.keys[i])),
    ...spec.metrics.flatMap((m) => (compared ? [value(m, row.values[m]), value(m, row.previous?.[m])] : [value(m, row.values[m])])),
    report.currency,
  ]);
  const total: Cell[] = [
    ...dates,
    ...spec.dimensions.map((_, i) => (i === 0 ? "total" : null)),
    ...spec.metrics.flatMap((m) => (compared ? [value(m, report.totals.values[m]), value(m, report.totals.previous?.[m])] : [value(m, report.totals.values[m])])),
    report.currency,
  ];
  return writeCsv([head, ...rows, total], dialect);
}
