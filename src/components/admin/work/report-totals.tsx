import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { formatMoney } from "@/lib/money";
import { formatDuration } from "@/lib/work-time";
import type { PeriodReport, ReportTotals } from "@/lib/work-reports";
import { workText } from "@/lib/work-text";
import { fillWords } from "@/lib/admin-fill";

function Figures({ total, locale, many }: { total: ReportTotals; locale: string; many: boolean }) {
  const tw = workText().reportTotals;
  const money = (minor: number) => formatMoney(minor, total.currency, locale);
  return (
    <div className="flex flex-col gap-2">
      {many && <h3 className="text-muted text-body-strong text-ink">{total.currency}</h3>}
      <StatGrid>
        <Stat
          label={tw.invoiced}
          value={money(total.netInvoicedMinor)}
          sub={total.creditedMinor > 0 ? `without VAT, after ${money(total.creditedMinor)} credited` : "without VAT"}
        />
        <Stat label={tw.paid} value={money(total.paidMinor)} sub="on those invoices, with VAT" />
        <Stat label={tw.outstanding} value={money(total.outstandingMinor)} sub="still owed on them, with VAT" />
        <Stat
          label={tw.unbilledTime}
          value={money(total.unbilledMinor)}
          sub={
            total.draftMinor > 0
              ? fillWords(tw.atRatesDrafts, { time: formatDuration(total.unbilledMinutes), amount: money(total.draftMinor) })
              : fillWords(tw.atRates, { time: formatDuration(total.unbilledMinutes) })
          }
        />
      </StatGrid>
    </div>
  );
}

/** The period's headline figures, one set per currency, and the hours (which are the same in any currency). */
export function ReportTotalsView({ report, locale }: { report: PeriodReport; locale: string }) {
  const tw = workText().reportTotals;
  const many = report.totals.length > 1;
  return (
    <section aria-label={tw.totals} className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        <span className="font-medium text-ink">{formatDuration(report.totalMinutes)}</span> logged,{" "}
        {formatDuration(report.totalBillableMinutes)} of it billable.
      </p>
      {report.totals.map((total) => (
        <Figures key={total.currency} total={total} locale={locale} many={many} />
      ))}
    </section>
  );
}
