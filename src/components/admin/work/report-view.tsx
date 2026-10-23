import Link from "next/link";

import { formatDay } from "@/lib/work-dates";
import {
  GROUP_LABELS,
  isEmptyReport,
  reportQuery,
  type PeriodReport,
  type ReportParams,
} from "@/lib/work-reports";

import { reportNotes } from "./report-columns";
import { ReportFilters } from "./report-filters";
import { ReportTable } from "./report-table";
import { ReportTotalsView } from "./report-totals";
import { secondaryButton } from "./work-parts";
import { workBase } from "@/lib/work-paths";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { workText } from "@/lib/work-text";

export type ReportViewProps = {
  storeSlug: string;
  locale: string;
  today: string;
  params: ReportParams;
  report: PeriodReport;
  clients: { id: string; name: string }[];
};

/**
 * Work's reports (docs/work.md 1.9, 5.2, 7.2 WP9): a period (presets or custom days, in the store's time
 * zone), by client or by assignment, with the totals, the table, a print view and a CSV download. All the
 * figures come from `getPeriodReport()`; the settings are in the address.
 */
export function ReportView({ storeSlug, locale, today, params, report, clients }: ReportViewProps) {
  const tw = workText().reportView;
  const base = `${workBase(storeSlug)}/reports`;
  const query = reportQuery(params);
  const empty = isEmptyReport(report);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title={tw.reports}
          description={<>{formatDay(report.from, locale)} to {formatDay(report.to, locale)}, {GROUP_LABELS[report.by].toLowerCase()}</>}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${base}/print${query}`} target="_blank" className={secondaryButton}>
            {tw.printView}
          </Link>
          <a href={`${base}/csv${query}`} download className={secondaryButton}>
            {tw.downloadCsv}
          </a>
          {params.clientId && (
            <a href={`${base}/csv${reportQuery(params, { format: "time" })}`} download className={secondaryButton}>
              {tw.timeEntriesCsv}
            </a>
          )}
        </div>
      </div>

      {params.problem && (
        <p role="alert" className="rounded-panel border border-line bg-card p-4 text-sm text-danger-text">
          {params.problem} {tw.showingThisMonth}
        </p>
      )}

      <ReportFilters base={base} params={params} today={today} clients={clients} />

      <ReportTotalsView report={report} locale={locale} />

      {empty ? (
        <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>
          {tw.nothingToReportIn}
        </p>
      ) : (
        <ReportTable report={report} locale={locale} />
      )}

      <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted">
        {reportNotes().map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
