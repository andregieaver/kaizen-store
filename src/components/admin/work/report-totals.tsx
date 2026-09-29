import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { formatMoney } from "@/lib/money";
import { formatDuration } from "@/lib/work-time";
import type { PeriodReport, ReportTotals } from "@/lib/work-reports";

function Figures({ total, locale, many }: { total: ReportTotals; locale: string; many: boolean }) {
  const money = (minor: number) => formatMoney(minor, total.currency, locale);
  return (
    <div className="flex flex-col gap-2">
      {many && <h3 className="text-sm font-medium text-muted">{total.currency}</h3>}
      <StatGrid>
        <Stat
          label="Invoiced"
          value={money(total.netInvoicedMinor)}
          sub={total.creditedMinor > 0 ? `without VAT, after ${money(total.creditedMinor)} credited` : "without VAT"}
        />
        <Stat label="Paid" value={money(total.paidMinor)} sub="on those invoices, with VAT" />
        <Stat label="Outstanding" value={money(total.outstandingMinor)} sub="still owed on them, with VAT" />
        <Stat
          label="Unbilled time"
          value={money(total.unbilledMinor)}
          sub={
            total.draftMinor > 0
              ? `${formatDuration(total.unbilledMinutes)} at your rates, and ${money(total.draftMinor)} in drafts`
              : `${formatDuration(total.unbilledMinutes)} at your rates, without VAT`
          }
        />
      </StatGrid>
    </div>
  );
}

/** The period's headline figures, one set per currency, and the hours (which are the same in any currency). */
export function ReportTotalsView({ report, locale }: { report: PeriodReport; locale: string }) {
  const many = report.totals.length > 1;
  return (
    <section aria-label="Totals" className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        <span className="font-medium text-foreground">{formatDuration(report.totalMinutes)}</span> logged,{" "}
        {formatDuration(report.totalBillableMinutes)} of it billable.
      </p>
      {report.totals.map((total) => (
        <Figures key={total.currency} total={total} locale={locale} many={many} />
      ))}
    </section>
  );
}
