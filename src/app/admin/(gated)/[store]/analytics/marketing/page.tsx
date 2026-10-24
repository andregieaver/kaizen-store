import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { DiscountsView } from "@/components/admin/analytics/discounts-view";
import { MarketingView, marketingLtv } from "@/components/admin/analytics/marketing-view";
import { SpendSection } from "@/components/admin/analytics/spend-form";
import { CampaignsView } from "@/components/admin/analytics/campaigns-view";
import { CampaignLinkBuilder, SpendImportForm } from "@/components/admin/analytics/campaign-link-builder";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminText, adminTexts } from "@/lib/admin-text";
import { queryText } from "@/lib/analytics-export";
import { todayIn } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";
import { storeHref, storeHome, storeOrigins } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { analyticsContext } from "@/server/analytics-context";
import { customersReport } from "@/server/analytics-customers-data";
import { discountsReport } from "@/server/analytics-discounts-data";
import { listSpend } from "@/server/analytics-settings";
import { campaignReport, marketingReport } from "@/server/analytics-traffic-data";

import { addSpendAction, deleteSpendAction, importSpendAction } from "./actions";

export const metadata: Metadata = { title: "Marketing analytics" };

/** How many entries of ad spend the list shows. */
const SPEND_LISTED = 25;

/**
 * What a customer costs, which channels pay back, where ad spend is entered, and how much is sold at a discount (D152). Thin on purpose:
 * it reads the period (and the comparison), the reports and the entries and hands them to the views. Predicted lifetime value comes from
 * the customers report; if that cannot be read the LTV:CAC card says so and the rest of the page is unaffected.
 */
export default async function AnalyticsMarketingPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/marketing">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  // Sales analytics are part of the online shop (D178 step 5): hidden while it is off; traffic stays.
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  const { store, settings, now } = ctx;
  const { period, compare } = ctx.params;
  const against = compare.previous ?? compare.lastYear;

  const model = query.model === "first" ? "first" : "last";
  const [report, previous, discounts, spend, customers, campaigns] = await Promise.all([
    marketingReport(store, period, now),
    against && compare.mode !== "none" ? marketingReport(store, against, now) : Promise.resolve(null),
    discountsReport(store, period),
    listSpend(store.id, { limit: SPEND_LISTED }),
    // The heaviest read of the page, and only one card needs it: the page is right without it.
    customersReport(store, period, settings, now).catch(() => null),
    campaignReport(store, period, model, now),
  ]);
  const start = storeHref(store.slug, storeHome(store.slug));
  const origins = storeOrigins(store.slug);
  const linkOrigins = origins.length > 0 ? origins : [new URL(siteUrl()).origin];
  const modelHref = (m: "last" | "first") => {
    const q = new URLSearchParams(queryText(query));
    if (m === "first") q.set("model", "first");
    else q.delete("model");
    const text = q.toString();
    return `${ctx.base}/analytics/marketing${text ? `?${text}` : ""}#campaigns`;
  };
  const currency = mainCurrency(store);
  const locale = ctx.lang === "en" ? (store.markets[0]?.locale ?? "en") : ctx.locale;
  const w = adminText(ctx.lang, "reports");

  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["reports", "analytics"])}>
    <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader
          ctx={ctx}
          path="/analytics/marketing"
          title={w.pages.marketing.title}
          description={w.pages.marketing.description}
        />
        <MarketingView
          base={ctx.base}
          currency={currency}
          locale={locale}
          report={report}
          comparison={previous && compare.mode !== "none" ? { mode: compare.mode, report: previous } : null}
          ltv={customers ? marketingLtv(customers.ltv) : null}
          words={w.marketing}
          channelWords={w.channels}
        />
        <CampaignsView report={campaigns} currency={currency} locale={locale} modelHref={modelHref} words={w.campaigns}>
          <div className="grid gap-4 lg:grid-cols-2">
            <CampaignLinkBuilder origins={linkOrigins} start={start.startsWith("http") ? start : `${linkOrigins[0]}${start}`} />
            <SpendImportForm action={importSpendAction.bind(null, store.slug)} currency={currency} />
          </div>
        </CampaignsView>
        <SpendSection
          currency={currency}
          locale={locale}
          today={todayIn(now, store.timeZone)}
          entries={spend}
          limit={SPEND_LISTED}
          actions={{ add: addSpendAction.bind(null, store.slug), remove: deleteSpendAction.bind(null, store.slug) }}
        />
        <DiscountsView currency={currency} locale={locale} report={discounts} words={w.discounts} />
      </div>
    </ExportScope>
    </AdminTextScope>
  );
}
