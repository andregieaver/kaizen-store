import { loyaltyEn, type LoyaltyMessages } from "@/lib/admin-messages/loyalty.en";
import { moneyIn, overviewRows } from "@/lib/bonus-admin";
import type { BonusOverview } from "@/lib/bonus";
import { CARD_CLASS } from "@/components/admin/ui";

/**
 * What the bonus program owes and did lately (D130), as the store's own figures: credits that can be used now are a
 * price reduction the store still has to give. Amounts are in the store's main currency.
 */
export function BonusOverviewCard({
  overview,
  locale,
  words = loyaltyEn,
}: {
  overview: BonusOverview;
  locale: string;
  words?: LoyaltyMessages;
}) {
  const rows = overviewRows(overview, moneyIn(overview.currency, locale), words.bonusOverview);
  return (
    <section
      aria-labelledby="bonus-overview-heading"
      className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}
    >
      <h2 id="bonus-overview-heading" className="text-title text-ink">
        {words.bonusOverview.heading}
      </h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5 rounded-md border border-line p-3">
            <dt className="text-sm text-muted">{row.label}</dt>
            <dd className="text-xl font-medium">{row.value}</dd>
            {row.hint && <dd className="text-xs text-muted">{row.hint}</dd>}
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted">{words.bonus.accountingNote}</p>
    </section>
  );
}
