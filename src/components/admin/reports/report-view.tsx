import { BarChart, LineChart, type Format } from "@/components/admin/analytics/charts";
import { change, formatChange, formatNumber, formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { CustomReportsMessages } from "@/lib/admin-messages/custom-reports.en";
import { METRICS, type MetricKey } from "@/lib/report-catalogue";
import type { ReportResult, ReportValues } from "@/server/report-query";

/**
 * A report's result (wave 8 unit A, D345): a table always (the rows the spec asked for, the rest row last, the totals under them, the
 * comparison beside each figure), a chart when asked (the first figure, over the rows' labels), and what the figures rest on: a column that
 * does not add up, orders left out for want of a rate, rows cut off, profit that is estimated. Presentational: the page reads the report
 * and its labels and hands them in.
 */
export function ReportView({
  report,
  labels,
  words,
  locale,
}: {
  report: ReportResult;
  /** One label per row and dimension, in the row's order. */
  labels: string[][];
  words: Pick<CustomReportsMessages, "catalogue" | "result" | "metricHelp">;
  locale: string;
}) {
  const w = words.result;
  const { spec } = report;
  const money = (minor: number) => formatAmount(minor, report.currency, locale);
  const show = (metric: MetricKey, value: number | null | undefined): string => {
    if (value === null || value === undefined) return metric === "gross_profit" ? w.noProfit : "–";
    return METRICS[metric].kind === "count" ? formatNumber(value) : money(value);
  };
  const compared = report.comparison !== null;
  const cell = (metric: MetricKey, values: ReportValues, previous: ReportValues | null) => {
    const now = values[metric];
    const then = previous?.[metric];
    const delta = compared && now !== null && now !== undefined && then !== null && then !== undefined ? change(now, then) : null;
    return (
      <>
        <td className="px-3 py-2 text-right tabular-nums">{show(metric, now)}</td>
        {compared && (
          <td className="px-3 py-2 text-right text-muted tabular-nums">
            {show(metric, then)}
            {delta && <span className="block text-caption">{formatChange(delta)}</span>}
          </td>
        )}
      </>
    );
  };

  const first = spec.metrics[0];
  const body = report.rows.filter((r) => !r.rest);
  const chartLabels = body.map((_, i) => labels[report.rows.indexOf(body[i])].join(" · "));
  const format: Format = (v) => show(first, v);
  const chart =
    spec.chart === "line" && spec.dimensions.length > 0 ? (
      <LineChart label={words.catalogue.metrics[first]} labels={chartLabels} series={[{ key: first, label: words.catalogue.metrics[first], values: body.map((r) => r.values[first] ?? null), previous: compared ? body.map((r) => r.previous?.[first] ?? null) : undefined }]} format={format} />
    ) : spec.chart === "bar" && spec.dimensions.length > 0 ? (
      <BarChart label={words.catalogue.metrics[first]} labels={chartLabels} series={[{ key: first, label: words.catalogue.metrics[first], values: body.map((r) => r.values[first] ?? null) }]} format={format} />
    ) : null;

  const notes: string[] = [];
  if (report.columns.some((c) => !c.addsUp) && spec.dimensions.length > 0) notes.push(w.doesNotAddUp);
  if (report.linesOnly) notes.push(w.linesOnly);
  if (report.hiddenRows > 0) notes.push(countWords(report.hiddenRows, w.truncated));
  if (report.unconverted > 0) notes.push(countWords(report.unconverted, w.unconverted, { currencies: report.missingCurrencies.join(", ") }));
  const coverage = report.totals.coverage;
  if (spec.metrics.includes("gross_profit") && coverage !== null && coverage < 1 && report.totals.values.gross_profit !== null) {
    notes.push(fillWords(w.coverage, { share: formatPercent(coverage, 0) }));
  }
  if (spec.metrics.includes("gross_profit") && report.totals.values.gross_profit === null) notes.push(w.noProfitHelp);

  return (
    <div className="flex flex-col gap-4" data-report-result>
      {chart}
      {report.rows.length === 0 && spec.dimensions.length > 0 ? (
        <p className="text-sm text-muted">{w.noRows}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-report-table>
            <thead>
              <tr className="border-b border-line text-left text-eyebrow text-muted">
                {spec.dimensions.map((d) => (
                  <th key={d} scope="col" className="px-3 py-2">
                    {words.catalogue.dimensions[d]}
                  </th>
                ))}
                {spec.metrics.map((m) => (
                  <th key={m} scope="col" colSpan={compared ? 2 : 1} className="px-3 py-2 text-right" title={words.metricHelp[m]}>
                    {words.catalogue.metrics[m]}
                    {compared && <span className="block font-normal">{`${words.catalogue.metrics[m]} · ${w.previous}`}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.rows.map((row, i) => (
                <tr key={row.keys.join("|") || "total"} data-rest={row.rest || undefined} className={row.rest ? "text-ink-2" : undefined}>
                  {labels[i].map((label, j) => (
                    <th key={j} scope="row" className="px-3 py-2 text-left font-normal">
                      {label}
                    </th>
                  ))}
                  {spec.metrics.map((m) => cell(m, row.values, row.previous))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-edge text-body-strong">
                <th scope="row" colSpan={Math.max(1, spec.dimensions.length)} className="px-3 py-2 text-left">
                  {w.total}
                </th>
                {spec.metrics.map((m) => cell(m, report.totals.values, report.totals.previous))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1 text-caption text-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
