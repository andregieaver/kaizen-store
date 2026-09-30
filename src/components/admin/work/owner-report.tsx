import Link from "next/link";

import { formatDay } from "@/lib/work-dates";
import { WORK_LOCALE, withStore, type OwnerReport, type WorkStore } from "@/lib/work-owner";
import { WORK_ROOT, workBase } from "@/lib/work-paths";
import {
  GROUP_LABELS,
  PRESET_LABELS,
  REPORT_GROUPS,
  REPORT_PRESETS,
  reportQuery,
  rowLabel,
  type ReportParams,
  type ReportPreset,
} from "@/lib/work-reports";

import { REPORT_HEADINGS, REPORT_NOTES, reportCells } from "./report-columns";
import { ReportTotalsView } from "./report-totals";
import { CurrencyNote, StoreFilter } from "./owner-common";
import { control, primaryButton, secondaryButton } from "./work-parts";

const chip = (current: boolean) =>
  `inline-flex min-h-9 items-center rounded-full border border-border px-3 text-sm ${
    current ? "bg-foreground text-background" : "bg-background"
  }`;
const th = "px-3 py-2 text-right text-xs font-medium tracking-wide text-muted uppercase";
const td = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

/**
 * The combined report (D123): the period, grouped by client or assignment, for all the account's stores or one.
 * Presets are worked out on each store's own day. The totals are per currency; each row belongs to a store and to
 * one currency, so nothing is added across currencies. A CSV download carries the store on every row.
 */
export function OwnerReportView({
  stores,
  params,
  report,
  storeSlug,
}: {
  stores: WorkStore[];
  params: ReportParams;
  report: OwnerReport;
  storeSlug: string;
}) {
  const many = stores.length > 1 && storeSlug === "";
  const base = `${WORK_ROOT}/reports`;
  const withScope = (query: string) => withStore(query, storeSlug);
  const query = withScope(reportQuery(params));
  const link = (change: Partial<Pick<ReportParams, "period" | "by">>) =>
    `${base}${withScope(reportQuery({ period: params.period, by: params.by, clientId: "", ...change }))}`;
  const currencies = new Set(report.rows.map((r) => r.currency));
  const manyCurrencies = report.totals.length > 1 || currencies.size > 1;
  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted">
            {formatDay(report.from || params.period.from, WORK_LOCALE)} to{" "}
            {formatDay(report.to || params.period.to, WORK_LOCALE)}, {GROUP_LABELS[report.by].toLowerCase()}
            {stores.length > 1 ? (storeSlug ? ", one store" : ", all stores") : ""}
          </p>
        </div>
        <a href={`${base}/csv${query}`} download className={secondaryButton}>
          Download CSV
        </a>
      </div>

      {params.problem && (
        <p role="alert" className="rounded-lg border border-border bg-background p-4 text-sm text-red-700 dark:text-red-400">
          {params.problem} Showing this month instead.
        </p>
      )}
      {report.periodsDiffer && (
        <p role="status" className="text-sm text-muted">
          The stores are in different time zones, so their &quot;this month&quot; and &quot;today&quot; can differ by a day.
        </p>
      )}

      <div className="flex flex-col gap-4">
        <nav aria-label="Period" className="flex flex-wrap gap-2">
          {REPORT_PRESETS.filter((p): p is Exclude<ReportPreset, "custom"> => p !== "custom").map((preset) => (
            <Link
              key={preset}
              href={`${base}${withScope(reportQuery({ period: { preset, from: "", to: "" }, by: params.by, clientId: "" }))}`}
              aria-current={params.period.preset === preset ? "page" : undefined}
              className={chip(params.period.preset === preset)}
            >
              {PRESET_LABELS[preset]}
            </Link>
          ))}
          <span
            aria-current={params.period.preset === "custom" ? "page" : undefined}
            className={chip(params.period.preset === "custom")}
          >
            {PRESET_LABELS.custom}
          </span>
        </nav>

        <nav aria-label="Group by" className="flex flex-wrap gap-2">
          {REPORT_GROUPS.map((by) => (
            <Link key={by} href={link({ by })} aria-current={params.by === by ? "page" : undefined} className={chip(params.by === by)}>
              {GROUP_LABELS[by]}
            </Link>
          ))}
        </nav>

        <form method="get" action={base} className="flex flex-wrap items-end gap-3" role="search" aria-label="Choose days and store">
          <input type="hidden" name="period" value="custom" />
          {params.by !== "client" && <input type="hidden" name="by" value={params.by} />}
          <label className="flex flex-col gap-1 text-sm font-medium">
            From
            <input type="date" name="from" required defaultValue={params.period.from} className={`${control} font-normal`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            To
            <input type="date" name="to" required defaultValue={params.period.to} className={`${control} font-normal`} />
          </label>
          <StoreFilter stores={stores} value={storeSlug} />
          <button type="submit" className={primaryButton}>
            Show report
          </button>
        </form>
      </div>

      <ReportTotalsView report={report} locale={WORK_LOCALE} />
      {(many || manyCurrencies) && <CurrencyNote />}

      {report.rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-5 text-sm text-muted">
          Nothing to report in these days: no time was logged, no invoice was issued and no draft was made.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Work report from {report.from} to {report.to}, by {report.by}
            </caption>
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left`}>
                  {report.by === "client" ? "Client" : "Assignment"}
                </th>
                {stores.length > 1 && (
                  <th scope="col" className={`${th} text-left`}>
                    Store
                  </th>
                )}
                {Object.values(REPORT_HEADINGS).map((heading) => (
                  <th key={heading} scope="col" className={th}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const cells = reportCells(row, row.currency, WORK_LOCALE);
                return (
                  <tr key={`${row.storeId}:${row.key}`} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {report.by === "assignment" && <span className="block text-xs text-muted">{row.clientName}</span>}
                      <span className="[overflow-wrap:anywhere]">{rowLabel(row, report.by)}</span>
                      {manyCurrencies && <span className="ml-2 text-xs text-muted">{row.currency}</span>}
                    </th>
                    {stores.length > 1 && (
                      <td className="px-3 py-2 text-left">
                        <Link href={`${workBase(row.storeSlug)}/reports`} className="underline">
                          {row.storeName}
                        </Link>
                      </td>
                    )}
                    <td className={td}>{cells.hours}</td>
                    <td className={td}>{cells.billable}</td>
                    <td className={td}>{cells.unbilled}</td>
                    <td className={td}>{cells.drafts}</td>
                    <td className={td}>
                      {cells.invoiced}
                      {cells.credited && <span className="block text-xs font-normal text-muted">{cells.credited}</span>}
                    </td>
                    <td className={td}>{cells.paid}</td>
                    <td className={td}>{cells.outstanding}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {report.totals.map((total) => {
                const cells = reportCells(total, total.currency, WORK_LOCALE);
                return (
                  <tr key={total.currency} className="border-t-2 border-border font-medium">
                    <th scope="row" className="px-3 py-2 text-left" colSpan={stores.length > 1 ? 2 : 1}>
                      Total{manyCurrencies ? ` (${total.currency})` : ""}
                    </th>
                    <td className={td}>{cells.hours}</td>
                    <td className={td}>{cells.billable}</td>
                    <td className={td}>{cells.unbilled}</td>
                    <td className={td}>{cells.drafts}</td>
                    <td className={td}>
                      {cells.invoiced}
                      {cells.credited && <span className="block text-xs font-normal text-muted">{cells.credited}</span>}
                    </td>
                    <td className={td}>{cells.paid}</td>
                    <td className={td}>{cells.outstanding}</td>
                  </tr>
                );
              })}
            </tfoot>
          </table>
        </div>
      )}

      <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted">
        {REPORT_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
