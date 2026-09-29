import Link from "next/link";

import { formatDay } from "@/lib/work-dates";
import {
  GROUP_LABELS,
  isEmptyReport,
  reportQuery,
  type PeriodReport,
  type ReportParams,
} from "@/lib/work-reports";

import { REPORT_NOTES } from "./report-columns";
import { ReportFilters } from "./report-filters";
import { ReportTable } from "./report-table";
import { ReportTotalsView } from "./report-totals";
import { secondaryButton } from "./work-parts";

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
  const base = `/admin/${storeSlug}/work/reports`;
  const query = reportQuery(params);
  const empty = isEmptyReport(report);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted">
            {formatDay(report.from, locale)} to {formatDay(report.to, locale)}, {GROUP_LABELS[report.by].toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${base}/print${query}`} target="_blank" className={secondaryButton}>
            Print view
          </Link>
          <a href={`${base}/csv${query}`} download className={secondaryButton}>
            Download CSV
          </a>
          {params.clientId && (
            <a href={`${base}/csv${reportQuery(params, { format: "time" })}`} download className={secondaryButton}>
              Time entries CSV
            </a>
          )}
        </div>
      </div>

      {params.problem && (
        <p role="alert" className="rounded-lg border border-border bg-background p-4 text-sm text-red-700 dark:text-red-400">
          {params.problem} Showing this month instead.
        </p>
      )}

      <ReportFilters base={base} params={params} today={today} clients={clients} />

      <ReportTotalsView report={report} locale={locale} />

      {empty ? (
        <p className="rounded-lg border border-border bg-background p-5 text-sm text-muted">
          Nothing to report in these days: no time was logged, no invoice was issued and no draft was made.
        </p>
      ) : (
        <ReportTable report={report} locale={locale} />
      )}

      <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted">
        {REPORT_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
