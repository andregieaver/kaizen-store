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
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { reportCells, reportHeadings, reportNotes } from "./report-columns";
import { ReportTotalsView } from "./report-totals";
import { CurrencyNote, StoreFilter } from "./owner-common";
import { control, primaryButton, secondaryButton } from "./work-parts";
import { workText } from "@/lib/work-text";
import { fillWords } from "@/lib/admin-fill";

const chip = (current: boolean) =>
  `inline-flex min-h-9 items-center rounded-full border border-edge px-3 text-sm ${
    current ? "bg-brand text-brand-ink" : "bg-card"
  }`;
const th = "px-3 py-2 text-right text-eyebrow text-muted uppercase";
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
  const tw = workText().ownerReport;
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
        <PageHeader
          title={tw.reports}
          description={<>{formatDay(report.from || params.period.from, WORK_LOCALE)} to{" "}{formatDay(report.to || params.period.to, WORK_LOCALE)}, {GROUP_LABELS[report.by].toLowerCase()}{stores.length > 1 ? (storeSlug ? ", one store" : ", all stores") : ""}</>}
        />
        <a href={`${base}/csv${query}`} download className={secondaryButton}>
          {tw.downloadCsv}
        </a>
      </div>

      {params.problem && (
        <p role="alert" className="rounded-panel border border-line bg-card p-4 text-sm text-danger-text">
          {params.problem} {tw.showingThisMonth}
        </p>
      )}
      {report.periodsDiffer && (
        <p role="status" className="text-sm text-muted">
          {tw.theStoresAreIn}
        </p>
      )}

      <div className="flex flex-col gap-4">
        <nav aria-label={tw.period} className="flex flex-wrap gap-2">
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

        <nav aria-label={tw.groupBy} className="flex flex-wrap gap-2">
          {REPORT_GROUPS.map((by) => (
            <Link key={by} href={link({ by })} aria-current={params.by === by ? "page" : undefined} className={chip(params.by === by)}>
              {GROUP_LABELS[by]}
            </Link>
          ))}
        </nav>

        <form method="get" action={base} className="flex flex-wrap items-end gap-3" role="search" aria-label={tw.chooseDaysAndStore}>
          <input type="hidden" name="period" value="custom" />
          {params.by !== "client" && <input type="hidden" name="by" value={params.by} />}
          <label className="flex flex-col gap-1 text-sm font-medium">
            {tw.from}
            <input type="date" name="from" required defaultValue={params.period.from} className={`${control} font-normal`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {tw.to}
            <input type="date" name="to" required defaultValue={params.period.to} className={`${control} font-normal`} />
          </label>
          <StoreFilter stores={stores} value={storeSlug} />
          <button type="submit" className={primaryButton}>
            {tw.showReport}
          </button>
        </form>
      </div>

      <ReportTotalsView report={report} locale={WORK_LOCALE} />
      {(many || manyCurrencies) && <CurrencyNote />}

      {report.rows.length === 0 ? (
        <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>
          {tw.nothingToReportIn}
        </p>
      ) : (
        <div className={`overflow-x-auto ${CARD_CLASS}`}>
          <table className="w-full text-sm">
            <caption className="sr-only">
              {fillWords(tw.reportCaption, { from: report.from, to: report.to, by: report.by })}
            </caption>
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left`}>
                  {report.by === "client" ? tw.client : tw.assignment}
                </th>
                {stores.length > 1 && (
                  <th scope="col" className={`${th} text-left`}>
                    {tw.store}
                  </th>
                )}
                {Object.values(reportHeadings()).map((heading) => (
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
                  <tr key={`${row.storeId}:${row.key}`} className="border-t border-line">
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
                  <tr key={total.currency} className="border-t-2 border-line font-medium">
                    <th scope="row" className="px-3 py-2 text-left" colSpan={stores.length > 1 ? 2 : 1}>
                      {tw.total}{manyCurrencies ? ` (${total.currency})` : ""}
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
        {reportNotes().map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
