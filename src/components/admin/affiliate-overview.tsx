import { overviewRows } from "@/lib/affiliate-admin";
import type { AffiliateOverview } from "@/lib/affiliates";
import { moneyIn } from "@/lib/bonus-admin";

/**
 * What the referral program did lately (D131), as the store's own figures. Referral credits are part of what the bonus
 * program owes: they are usable as a price reduction like any other credits. Amounts are in the credits' currency.
 */
export function AffiliateOverviewCard({ overview, locale }: { overview: AffiliateOverview; locale: string }) {
  const rows = overviewRows(overview, moneyIn(overview.currency, locale));
  return (
    <section
      aria-labelledby="affiliate-overview-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5"
    >
      <h2 id="affiliate-overview-heading" className="font-medium">
        Referrals at a glance
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
    </section>
  );
}
