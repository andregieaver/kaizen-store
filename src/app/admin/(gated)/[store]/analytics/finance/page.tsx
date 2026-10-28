import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { FinanceView, type FinancePeriodData } from "@/components/admin/analytics/finance-view";
import { GiftCardsView } from "@/components/admin/analytics/gift-cards-view";
import { LiabilitiesView } from "@/components/admin/analytics/liabilities-view";
import { PaymentsView } from "@/components/admin/analytics/payments-view";
import { TermsOwedView } from "@/components/admin/analytics/terms-owed-view";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminText, adminTexts } from "@/lib/admin-text";
import { queryText } from "@/lib/analytics-export";
import { financeStatement } from "@/lib/analytics-finance";
import { bucketFor, type AnalyticsPeriod } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";
import { analyticsContext, type AnalyticsContext } from "@/server/analytics-context";
import { paymentMethodsReport } from "@/server/analytics-payments-data";
import { analyticsSetupSummary } from "@/server/analytics-settings-data";
import { periodTotals, seriesByBucket } from "@/server/analytics-totals";
import { giftCardLiability } from "@/server/gift-cards-admin";
import { liabilityRows } from "@/server/liabilities";
import { termsOwedReport } from "@/server/payment-terms";

export const metadata: Metadata = { title: "Finance" };

/** One period's totals with its statement worked out, as the view takes them. */
async function periodData(ctx: AnalyticsContext, period: AnalyticsPeriod): Promise<FinancePeriodData> {
  const { totals, unconverted, missingCurrencies } = await periodTotals(ctx.store, period, ctx.settings);
  const words = adminText(ctx.lang, "finance").statement;
  return { label: period.label, totals, statement: financeStatement(totals, ctx.settings, period.days, words), unconverted, missingCurrencies };
}

/**
 * From gross sales to operating profit (D152): how much of what the store sells is left, where the rest goes, and how far the
 * figures can be trusted. Thin on purpose: it reads the period and the comparison and hands them to `FinanceView`.
 */
export default async function AnalyticsFinancePage({ params, searchParams }: PageProps<"/admin/[store]/analytics/finance">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  // Sales analytics are part of the online shop (D178 step 5): hidden while it is off; traffic stays.
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  const { store, settings, locale } = ctx;
  const words = adminText(ctx.lang, "finance");
  const { period, compare } = ctx.params;
  const against = compare.previous ?? compare.lastYear;
  const bucket = bucketFor(period);

  const [current, comparison, series, comparisonSeries, setup, payments, owed, giftCards, liabilities] = await Promise.all([
    periodData(ctx, period),
    against ? periodData(ctx, against) : Promise.resolve(null),
    seriesByBucket(store, period, bucket, settings),
    against ? seriesByBucket(store, against, bucket, settings) : Promise.resolve(null),
    // How many products lack a cost is a nicety: the page is right without it.
    analyticsSetupSummary(store.id).catch(() => null),
    // What the paid orders were paid with (D288).
    paymentMethodsReport(store, period, settings),
    // What companies owe on payment terms today (D293): not a figure of the period.
    termsOwedReport(store),
    // What customers hold on gift cards (D300 F4): money owed, never a sale; each currency on its own.
    giftCardLiability(store, period),
    // What the store owes customers as bonus credit and gift cards (D381): each ledger's roll-forward and what is held now.
    liabilityRows(store, period),
  ]);

  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["finance", "analytics"])}>
    <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader ctx={ctx} path="/analytics/finance" title={words.pages.financeTitle} description={words.pages.financeDescription} />
        <FinanceView
          base={ctx.base}
          currency={mainCurrency(store)}
          locale={locale}
          isOwner={ctx.owner}
          current={current}
          comparison={comparison && compare.mode !== "none" ? { mode: compare.mode, data: comparison } : null}
          bucket={bucket}
          series={series}
          comparisonSeries={comparisonSeries}
          setup={setup}
          words={words}
        />
        <PaymentsView currency={mainCurrency(store)} locale={locale} report={payments} words={words} />
        <TermsOwedView base={ctx.base} currency={mainCurrency(store)} locale={locale} owed={owed} words={words} />
        <LiabilitiesView locale={locale} rows={liabilities} words={words} />
        <GiftCardsView base={ctx.base} locale={locale} lines={giftCards.lines} words={words} />
      </div>
    </ExportScope>
    </AdminTextScope>
  );
}
