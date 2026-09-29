import type { PeriodReport, ReportGroupBy, ReportRow, ReportTotals } from "@/lib/work-reports";
import { rowLabel } from "@/lib/work-reports";

import { REPORT_HEADINGS, reportCells } from "./report-columns";

const th = "px-3 py-2 text-right text-xs font-medium tracking-wide text-muted uppercase";
const td = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

function Head({ by }: { by: ReportGroupBy }) {
  return (
    <tr>
      <th scope="col" className={`${th} text-left`}>
        {by === "client" ? "Client" : "Assignment"}
      </th>
      {Object.values(REPORT_HEADINGS).map((h) => (
        <th key={h} scope="col" className={th}>
          {h}
        </th>
      ))}
    </tr>
  );
}

function Cells({ cells }: { cells: ReturnType<typeof reportCells> }) {
  return (
    <>
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
    </>
  );
}

function RowView({ row, by, locale, showCurrency }: { row: ReportRow; by: ReportGroupBy; locale: string; showCurrency: boolean }) {
  return (
    <tr className="border-t border-border">
      <th scope="row" className="px-3 py-2 text-left font-normal">
        {by === "assignment" && <span className="block text-xs text-muted">{row.clientName}</span>}
        <span className="[overflow-wrap:anywhere]">{rowLabel(row, by)}</span>
        {showCurrency && <span className="ml-2 text-xs text-muted">{row.currency}</span>}
      </th>
      <Cells cells={reportCells(row, row.currency, locale)} />
    </tr>
  );
}

function TotalView({ total, locale, many }: { total: ReportTotals; locale: string; many: boolean }) {
  return (
    <tr className="border-t-2 border-border font-medium">
      <th scope="row" className="px-3 py-2 text-left">
        Total{many ? ` (${total.currency})` : ""}
      </th>
      <Cells cells={reportCells(total, total.currency, locale)} />
    </tr>
  );
}

/**
 * The report as a table (docs/work.md 5.2): a row per client or assignment with its hours, the value of time
 * not yet invoiced, drafts, what was invoiced (after credit notes), paid and outstanding, and a total per
 * currency. Every figure is worked out on the server; this only lays them out. Scrolls sideways on a phone.
 */
export function ReportTable({ report, locale }: { report: PeriodReport; locale: string }) {
  const currencies = new Set(report.rows.map((r) => r.currency));
  const many = report.totals.length > 1 || currencies.size > 1;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Work report from {report.from} to {report.to}, by {report.by}
        </caption>
        <thead>
          <Head by={report.by} />
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <RowView key={row.key} row={row} by={report.by} locale={locale} showCurrency={many} />
          ))}
        </tbody>
        <tfoot>
          {report.totals.map((total) => (
            <TotalView key={total.currency} total={total} locale={locale} many={many} />
          ))}
        </tfoot>
      </table>
    </div>
  );
}
