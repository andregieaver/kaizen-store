import { BONUS_ACCOUNTING_NOTE, moneyIn, overviewRows } from "@/lib/bonus-admin";
import type { BonusOverview } from "@/lib/bonus";

/**
 * What the bonus program owes and did lately (D130), as the store's own figures: credits that can be used now are a
 * price reduction the store still has to give. Amounts are in the store's main currency.
 */
export function BonusOverviewCard({ overview, locale }: { overview: BonusOverview; locale: string }) {
  const rows = overviewRows(overview, moneyIn(overview.currency, locale));
  return (
    <section
      aria-labelledby="bonus-overview-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5"
    >
      <h2 id="bonus-overview-heading" className="font-medium">
        Credits at a glance
      </h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5 rounded-md border border-border p-3">
            <dt className="text-sm text-muted">{row.label}</dt>
            <dd className="text-xl font-semibold">{row.value}</dd>
            {row.hint && <dd className="text-xs text-muted">{row.hint}</dd>}
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted">{BONUS_ACCOUNTING_NOTE}</p>
    </section>
  );
}
