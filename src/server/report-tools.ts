import "server-only";

import { change, formatChange, formatNumber, formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { countWords, fillWords } from "@/lib/admin-fill";
import { analyticsEn } from "@/lib/admin-messages/analytics.en";
import { customReportsEn } from "@/lib/admin-messages/custom-reports.en";
import type { OwnerToolInput } from "@/lib/owner-tools";
import {
  allowedDimensions,
  COMPARE_KEYS,
  describeSpec,
  DIMENSION_KEYS,
  MAX_DIMENSIONS,
  MAX_METRICS,
  MAX_ROWS,
  METRIC_KEYS,
  METRICS,
  OVERLAPPING,
  PERIOD_PRESETS,
  specProblems,
  type MetricKey,
  type SpecProblem,
} from "@/lib/report-catalogue";
import { reportLink } from "@/lib/report-link";
import { problemText } from "@/lib/report-words";

import { OwnerToolError } from "./owner-tool-error";
import type { OwnerToolContext } from "./owner-tools";
import { labelOf, reportLabels } from "./report-labels";
import { runReport, type ReportResult, type ReportValues } from "./report-query";
import { saveReport } from "./saved-reports";
import type { Store } from "./stores";

/**
 * The AI manager's report tools (wave 8 unit B, D346): the catalogue in the Reports page's own words, a report run by the one compiler
 * (`runReport()`), and a report saved through `saved-reports.ts`. Every figure is counted and written out in code; the model fills a spec
 * and repeats what comes back. A spec the catalogue refuses is refused with `specProblems()` in words and what can be asked instead.
 * The words are English (the model answers in the person's language); labels and amounts use the store's main language and format.
 */

const W = customReportsEn;
/** Rows handed to the model; the rest are counted and left to the report's page. */
export const TOOL_ROWS = 40;

const mainLocale = (store: Store) => store.markets[0]?.locale ?? "en";
const reportsPath = (store: Store) => `/admin/${store.slug}/analytics/reports`;


/** What the model is told when a spec cannot run: each problem, then what can be asked. */
function refusal(problems: SpecProblem[]): never {
  throw new OwnerToolError(
    `${problems.map((p) => problemText(p, W)).join(" ")} Call report_catalogue for the figures and the cuts each allows.`,
  );
}

export async function reportCatalogueTool() {
  return {
    figures: METRIC_KEYS.map((key) => ({
      key,
      name: W.catalogue.metrics[key],
      means: W.metricHelp[key],
      kind: METRICS[key].kind === "count" ? "a count" : METRICS[key].kind === "average" ? "an average amount" : "an amount",
      can_be_cut_by: allowedDimensions(key),
    })),
    cuts: DIMENSION_KEYS.map((key) => ({
      key,
      name: W.catalogue.dimensions[key],
      ...(OVERLAPPING.has(key) ? { note: "One line or order can be in several rows, so its columns do not add up." } : {}),
    })),
    periods: Object.fromEntries(PERIOD_PRESETS.map((p) => [p, analyticsEn.period.presets[p] ?? p])),
    comparisons: Object.fromEntries(COMPARE_KEYS.map((c) => [c, analyticsEn.compare.modes[c]])),
    limits: { figures: MAX_METRICS, cuts: MAX_DIMENSIONS, rows: MAX_ROWS },
    filter_values:
      "A filter's values are the keys run_report gives each row (`key`): ids for products, variants, categories and tags (from list_products, get_product or an earlier report), a country code for country, a currency code for currency, `new` or `returning` for new or returning customers.",
    basis: "Every amount is in the store's main currency without VAT, counted from paid orders; a currency with no exchange rate is left out and counted.",
  };
}

/** A figure written out as the Reports page writes it. */
function show(metric: MetricKey, value: number | null | undefined, report: ReportResult, locale: string): string {
  if (value === null || value === undefined) return metric === "gross_profit" ? W.result.noProfit : "not known";
  return METRICS[metric].kind === "count" ? formatNumber(value) : formatAmount(value, report.currency, locale);
}

function figures(report: ReportResult, values: ReportValues, previous: ReportValues | null, locale: string) {
  return Object.fromEntries(
    report.spec.metrics.map((m) => {
      const now = values[m];
      const then = previous?.[m];
      const delta = previous && now !== null && now !== undefined && then !== null && then !== undefined ? change(now, then) : null;
      return [
        W.catalogue.metrics[m],
        previous ? { now: show(m, now, report, locale), before: show(m, then, report, locale), ...(delta ? { change: formatChange(delta) } : {}) } : show(m, now, report, locale),
      ];
    }),
  );
}

/** What the figures rest on, as the page's notes say it. */
function notes(report: ReportResult, shownRows: number): string[] {
  const out: string[] = [];
  const { spec } = report;
  if (report.columns.some((c) => !c.addsUp) && spec.dimensions.length > 0) out.push(W.result.doesNotAddUp);
  if (report.rows.some((r) => r.rest)) out.push("The row named for shipping and other order amounts holds what the orders' totals have and no product line carries, so the column adds up to the total.");
  if (report.linesOnly) out.push(W.result.linesOnly);
  const hidden = report.hiddenRows + (report.rows.length - shownRows);
  if (hidden > 0) out.push(`${countWords(hidden, W.result.truncated)} Open the report for every row.`);
  if (report.unconverted > 0) out.push(countWords(report.unconverted, W.result.unconverted, { currencies: report.missingCurrencies.join(", ") }));
  const coverage = report.totals.coverage;
  if (spec.metrics.includes("gross_profit")) {
    if (report.totals.values.gross_profit === null) out.push(W.result.noProfitHelp);
    else if (coverage !== null && coverage < 1) out.push(fillWords(W.result.coverage, { share: formatPercent(coverage, 0) }));
  }
  return out;
}

export async function runReportTool({ store }: OwnerToolContext, spec: OwnerToolInput<"run_report">) {
  const problems = specProblems(spec);
  if (problems.length > 0) refusal(problems);
  const outcome = await runReport(store, spec);
  if (!outcome.ok) refusal(outcome.problems);
  const { report } = outcome;
  const locale = mainLocale(store);
  const labels = await reportLabels(store, report, "en", locale);
  const rows = report.rows.slice(0, TOOL_ROWS);
  return {
    report: describeSpec(spec, W.catalogue, {
      period: report.period.label,
      comparison: report.comparison ? (spec.period.compare === "year" ? analyticsEn.compare.theLastYear : analyticsEn.compare.thePrevious) : null,
      currency: report.currency,
      filterValue: (d, v) => labelOf(labels, d, v),
    }),
    rows: rows.map((row) => ({
      ...(spec.dimensions.length
        ? { row: spec.dimensions.map((d, i) => labelOf(labels, d, row.keys[i])).join(" · "), key: row.rest ? undefined : row.keys.join(" · ") }
        : {}),
      figures: figures(report, row.values, row.previous, locale),
    })),
    total: figures(report, report.totals.values, report.totals.previous, locale),
    notes: notes(report, rows.length),
    link: reportLink(store.slug, spec),
  };
}

export async function saveReportTool({ store, account }: OwnerToolContext, { title, spec }: OwnerToolInput<"save_report">) {
  const saved = await saveReport(store.id, account.id, { title, spec });
  if (!saved.ok) {
    if (saved.reason === "spec" && saved.problems?.length) refusal(saved.problems);
    if (saved.reason === "too_many") throw new OwnerToolError(W.save.tooMany);
    if (saved.reason === "title") throw new OwnerToolError(W.save.nameMissing);
    throw new OwnerToolError("The report could not be saved.");
  }
  return { saved: title, link: `${reportsPath(store)}/view?id=${saved.id}` };
}
