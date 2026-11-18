import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { countWords, fillWords } from "@/lib/admin-fill";
import { submitClass } from "@/lib/submit-class";
import { setVisitCountingAction } from "../settings/actions";

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
import { formatMoney } from "@/lib/money";
import { Card } from "@/components/admin/ui";
import { dayStart } from "@/server/analytics-sql";
import { creditBySource, SOURCES } from "@/server/order-credit";
import { storeHref, storeHome, storeOrigins } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { analyticsContext } from "@/server/analytics-context";
import { analyticsCaptions, analyticsSay } from "@/server/analytics-say";
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
  const [report, previous, discounts, spend, customers, campaigns, messages] = await Promise.all([
    marketingReport(store, period, now),
    against && compare.mode !== "none" ? marketingReport(store, against, now) : Promise.resolve(null),
    discountsReport(store, period),
    listSpend(store.id, { limit: SPEND_LISTED }),
    // The heaviest read of the page, and only one card needs it: the page is right without it.
    customersReport(store, period, settings, now).catch(() => null),
    campaignReport(store, period, model, now),
    // M1.4 (D761): what the store's own emails and texts were followed by, by the one rule.
    creditBySource(store.id, dayStart(store, period.from), dayStart(store, period.to)),
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
  const say = analyticsSay(ctx.lang, ctx.locale);
  const hasSpend = report.spend.totalMinor > 0;
  const pw = w.marketing.phone;
  const row = { change: pw.open, done: pw.close, flat: true } as const;

  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["reports", "analytics"])}>
    <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport} captions={analyticsCaptions(ctx.lang)}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader
          ctx={ctx}
          path="/analytics/marketing"
          title={w.pages.marketing.title}
          description={<span className="max-sm:hidden">{w.pages.marketing.description}</span>}
        />
        {/* Round 29 (D702): on a phone what the figures need is said once, with its press, and every section is a row. */}
        {(!hasSpend || !report.counting) && (
          <section aria-label={pw.needsTitle} className="flex flex-col gap-3 rounded-panel bg-card p-4 sm:hidden">
            <h2 className="text-body-strong text-ink">{pw.needsTitle}</h2>
            <p className="flex items-center justify-between gap-3 text-sm text-ink-2">
              {hasSpend ? pw.spendIn : pw.spendNone}
              {!hasSpend && (
                <a href="#spend" className="inline-flex h-9 shrink-0 items-center rounded-pill bg-ink px-4 text-sm text-canvas">
                  {pw.addSpend}
                </a>
              )}
            </p>
            <p className="flex items-center justify-between gap-3 text-sm text-ink-2">
              {report.counting ? pw.countingOn : pw.countingOff}
              {!report.counting &&
                (ctx.owner ? (
                  <ActionForm action={setVisitCountingAction.bind(null, store.slug)} successMessage={adminText(ctx.lang, "analytics").settings.visits.nowOn}>
                    <SubmitButton name="enabled" value="on" className={`${submitClass()} min-h-9`}>
                      {pw.turnOn}
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <a href={`${ctx.base}/analytics/settings#visits`} className="shrink-0 text-sm font-medium text-ink underline underline-offset-2">
                    {pw.turnOn}
                  </a>
                ))}
            </p>
          </section>
        )}
        <PhoneRows>
        <MarketingView
          base={ctx.base}
          currency={currency}
          locale={locale}
          report={report}
          comparison={previous && compare.mode !== "none" ? { mode: compare.mode, report: previous } : null}
          ltv={customers ? marketingLtv(customers.ltv) : null}
          words={w.marketing}
          channelWords={w.channels}
          say={say}
        />
        <PhoneRow opens="campaigns" title={w.campaigns.title} sub={pw.campaignsSub} {...row}>
        <CampaignsView report={campaigns} currency={currency} locale={locale} modelHref={modelHref} words={w.campaigns}>
          <div className="grid gap-4 lg:grid-cols-2">
            <CampaignLinkBuilder origins={linkOrigins} start={start.startsWith("http") ? start : `${linkOrigins[0]}${start}`} />
            <SpendImportForm action={importSpendAction.bind(null, store.slug)} currency={currency} />
          </div>
        </CampaignsView>
        </PhoneRow>
        <PhoneRow id="spend-row" opens="spend" title={pw.spendTitle} sub={spend.length > 0 ? countWords(spend.length, pw.spendEntries, { n: String(spend.length) }) : pw.spendNoneSub} {...row}>
        <SpendSection
          currency={currency}
          locale={locale}
          today={todayIn(now, store.timeZone)}
          entries={spend}
          limit={SPEND_LISTED}
          actions={{ add: addSpendAction.bind(null, store.slug), remove: deleteSpendAction.bind(null, store.slug) }}
        />
        </PhoneRow>
        <PhoneRow
          opens="messages"
          title={pw.messagesTitle}
          sub={(() => {
            const all = SOURCES.reduce((sum, src) => sum + messages[src].orders, 0);
            return all === 0 ? pw.messagesSub.none : countWords(all, pw.messagesSub, { n: String(all) });
          })()}
          {...row}
        >
          <Card title={pw.messagesTitle} description={w.marketing.messages.lead} compact>
            <dl className="flex flex-col" data-message-orders>
              {SOURCES.map((src) => (
                <div key={src} className="flex justify-between gap-4 border-b border-line py-2 last:border-b-0">
                  <dt className="text-body text-ink-2">{w.marketing.messages.sources[src]}</dt>
                  <dd className="text-right text-body-strong tabular-nums text-ink">
                    {messages[src].orders === 0
                      ? w.marketing.messages.none
                      : `${countWords(messages[src].orders, w.marketing.messages.orders, { n: messages[src].orders.toLocaleString(locale) })} · ${Object.entries(messages[src].minor)
                          .map(([cur, minor]) => formatMoney(minor, cur, locale))
                          .join(" + ")}`}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </PhoneRow>
        <PhoneRow
          opens="discounts"
          title={w.discounts.title}
          sub={fillWords(pw.discountsSub, { n: String(discounts.summary.discountedOrders), all: String(discounts.summary.orders) })}
          {...row}
        >
          <DiscountsView currency={currency} locale={locale} report={discounts} words={w.discounts} say={say} />
        </PhoneRow>
        </PhoneRows>
      </div>
    </ExportScope>
    </AdminTextScope>
  );
}
