import { DOCUMENT_CSS } from "@/components/work/invoice-document";
import { formatDay } from "@/lib/work-dates";
import { formatDuration } from "@/lib/work-time";
import { GROUP_LABELS, isEmptyReport, rowLabel, type PeriodReport } from "@/lib/work-reports";

import { REPORT_HEADINGS, REPORT_NOTES, reportCells } from "./report-columns";

/**
 * A report on paper: landscape A4, black on white whatever the colour mode, drawn with the invoice
 * document's own styles (`.wd`), so it prints and saves as a PDF the same way. No `>`, quote or `&`
 * in the style: React escapes them in a style element, which would break the rule.
 */
export const REPORT_PRINT_CSS = `
@page { size: A4 landscape; margin: 12mm; }
.wd.wd-report { max-width: 297mm; }
.wd.wd-report h1 { font-size: 18pt; }
.wd.wd-report table { table-layout: auto; font-size: 9pt; margin-top: 6mm; }
.wd.wd-report th.wd-name, .wd.wd-report td.wd-name { width: 26%; text-align: left; }
.wd.wd-report tfoot th, .wd.wd-report tfoot td { font-weight: 700; border-top: 1.5px solid #000; }
.wd.wd-report .wd-small { font-size: 8pt; color: #333; display: block; }
.wd.wd-report .wd-notes { margin-top: 8mm; font-size: 8.5pt; color: #333; }
`;

export function ReportPrintView({
  storeName,
  locale,
  today,
  report,
}: {
  storeName: string;
  locale: string;
  today: string;
  report: PeriodReport;
}) {
  const many = report.totals.length > 1;
  return (
    <>
      <style>{DOCUMENT_CSS}</style>
      <style>{REPORT_PRINT_CSS}</style>
      <article className="wd wd-report" aria-label="Work report">
        <header className="wd-head">
          <div>
            <h1>Work report</h1>
            <p className="wd-muted">{storeName}</p>
          </div>
          <dl className="wd-meta">
            <div>
              <dt>Period</dt>
              <dd>
                {formatDay(report.from, locale)} to {formatDay(report.to, locale)}
              </dd>
            </div>
            <div>
              <dt>Grouped</dt>
              <dd>{GROUP_LABELS[report.by].replace("By ", "by ")}</dd>
            </div>
            <div>
              <dt>Made</dt>
              <dd>{formatDay(today, locale)}</dd>
            </div>
            <div>
              <dt>Time logged</dt>
              <dd>
                {formatDuration(report.totalMinutes)} ({formatDuration(report.totalBillableMinutes)} billable)
              </dd>
            </div>
          </dl>
        </header>

        {isEmptyReport(report) ? (
          <p className="wd-block">Nothing to report in these days.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col" className="wd-name">
                  {report.by === "client" ? "Client" : "Assignment"}
                </th>
                {Object.values(REPORT_HEADINGS).map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const c = reportCells(row, row.currency, locale);
                return (
                  <tr key={row.key}>
                    <th scope="row" className="wd-name">
                      {report.by === "assignment" && <span className="wd-small">{row.clientName}</span>}
                      {rowLabel(row, report.by)}
                      {many && <span className="wd-small">{row.currency}</span>}
                    </th>
                    <td className="wd-num">{c.hours}</td>
                    <td className="wd-num">{c.billable}</td>
                    <td className="wd-num">{c.unbilled}</td>
                    <td className="wd-num">{c.drafts}</td>
                    <td className="wd-num">
                      {c.invoiced}
                      {c.credited && <span className="wd-small">{c.credited}</span>}
                    </td>
                    <td className="wd-num">{c.paid}</td>
                    <td className="wd-num">{c.outstanding}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {report.totals.map((t) => {
                const c = reportCells(t, t.currency, locale);
                return (
                  <tr key={t.currency}>
                    <th scope="row" className="wd-name">
                      Total{many ? ` (${t.currency})` : ""}
                    </th>
                    <td className="wd-num">{c.hours}</td>
                    <td className="wd-num">{c.billable}</td>
                    <td className="wd-num">{c.unbilled}</td>
                    <td className="wd-num">{c.drafts}</td>
                    <td className="wd-num">{c.invoiced}</td>
                    <td className="wd-num">{c.paid}</td>
                    <td className="wd-num">{c.outstanding}</td>
                  </tr>
                );
              })}
            </tfoot>
          </table>
        )}

        <ul className="wd-notes">
          {REPORT_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </article>
    </>
  );
}
