import Link from "next/link";

import { countWords } from "@/lib/admin-fill";
import { financeEn, type FinanceMessages } from "@/lib/admin-messages/finance.en";
import { formatCount } from "@/lib/analytics-core";
import type { TermsOwed } from "@/server/payment-terms";

import { AnalyticsSection, Note } from "./section";
import { safeMoney } from "./subscriptions-view";

/**
 * What companies owe on payment terms (wave 4 unit F, D293, docs/analytics.md "Owed on payment terms"): the invoices not yet paid, due and overdue, as
 * they stand today in the main currency. Not revenue: an order on terms is a sale when its money arrives. Drawn only when something is owed.
 */
export function TermsOwedView({ base, currency, locale, owed, words = financeEn }: { base: string; currency: string; locale: string; owed: TermsOwed; words?: FinanceMessages }) {
  const w = words.termsOwed;
  if (owed.dueOrders + owed.overdueOrders === 0) return null;
  const money = safeMoney(currency, locale);
  const orders = (n: number) => countWords(n, w.orders, { n: formatCount(n) });
  return (
    <AnalyticsSection
      id="payment-terms"
      title={w.title}
      description={w.description}
    >
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-panel border border-line p-4">
          <dt className="text-eyebrow text-muted">{w.due}</dt>
          <dd className="text-metric text-ink tabular-nums">{money(owed.dueMinor)}</dd>
          <dd className="text-sm text-muted">
            <Link href={`${base}/orders?pay=terms_due`} className="underline-offset-2 hover:underline">
              {orders(owed.dueOrders)}
            </Link>
          </dd>
        </div>
        <div className="rounded-panel border border-line p-4">
          <dt className="text-eyebrow text-muted">{w.overdue}</dt>
          <dd className={`text-metric tabular-nums ${owed.overdueMinor > 0 ? "text-danger-text" : "text-ink"}`}>{money(owed.overdueMinor)}</dd>
          <dd className="text-sm text-muted">
            <Link href={`${base}/orders?pay=terms_overdue`} className="underline-offset-2 hover:underline">
              {orders(owed.overdueOrders)}
            </Link>
          </dd>
        </div>
      </dl>
      {owed.unconverted > 0 && (
        <Note>{countWords(owed.unconverted, w.leftOut, { orders: orders(owed.unconverted), currencies: owed.missingCurrencies.join(", "), them: owed.missingCurrencies.length === 1 ? w.it : w.them })}</Note>
      )}
    </AnalyticsSection>
  );
}
