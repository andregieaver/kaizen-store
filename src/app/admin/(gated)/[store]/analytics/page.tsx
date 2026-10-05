import type { Metadata } from "next";
import { Suspense } from "react";

import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { AnswerSection, ChartsSection, OverviewLayout, SectionSkeleton, type OverviewFrame } from "@/components/admin/analytics/overview-sections";
import { AlertsStream, ChannelsStream, DiagnosisStream, ForecastStream, FunnelStream, ProductsStream, TargetStream, type StreamProps } from "@/components/admin/analytics/overview-streams";
import { queryText } from "@/lib/analytics-export";
import { analyticsContext } from "@/server/analytics-context";
import { overviewReads } from "@/server/analytics-overview-reads";
import { overviewHead } from "@/server/analytics-totals";
import { sessionTotals } from "@/server/analytics-traffic-data";

export const metadata: Metadata = { title: "Analytics" };

/**
 * The store's first screen of analytics (D152): are we making money, why are sales moving, is there anything to act on today.
 *
 * The page itself reads only the first screen (the figures, the cards and the net revenue and profit charts: `overviewHead()`, with the
 * visits it needs as one cheap read of the sessions) and draws it as soon as that is in. Every other section is an async component in
 * its own `<Suspense>`, reading its own data side by side with the rest, so none waits for one it does not need and a slow one never
 * holds the page back (docs/analytics.md). What two sections both read (the daily history, the funnel's and the channels' reports,
 * which the diagnosis uses too) is read once, through `reads`.
 */
export default async function AnalyticsOverviewPage({ params, searchParams }: PageProps<"/admin/[store]/analytics">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const { store, now } = ctx;

  const data = await overviewHead(store, query, now, { sessions: (period) => sessionTotals(store, period), settings: ctx.settings });

  const frame: OverviewFrame = { base: ctx.base, currency: data.currency, locale: store.markets[0]?.locale ?? "en", isOwner: ctx.owner, params: data.params };
  const stream: StreamProps = { ctx, frame, reads: overviewReads(store, now, ctx.settings) };

  return (
    <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader
          ctx={ctx}
          path="/analytics"
          title="Overview"
          description="Are we making money, why are sales moving, and is there anything to do today? Each figure links to the page that explains it."
        />
        <OverviewLayout
          currency={data.currency}
          slots={{
            // The place of "Needs you today" is kept, at about the height of one alert, so what is under it does not jump when it arrives.
            alerts: (
              <Suspense fallback={<SectionSkeleton kind="alerts" label="what needs you today" />}>
                <AlertsStream {...stream} />
              </Suspense>
            ),
            answer: <AnswerSection frame={frame} data={data} visitCounting={store.visitCounting} />,
            why: (
              <Suspense fallback={<SectionSkeleton kind="why" label="why sales changed" />}>
                <DiagnosisStream {...stream} />
              </Suspense>
            ),
            charts: <ChartsSection frame={frame} data={data} />,
            funnel: (
              <Suspense fallback={<SectionSkeleton kind="funnel" label="the funnel" />}>
                <FunnelStream {...stream} />
              </Suspense>
            ),
            products: (
              <Suspense fallback={<SectionSkeleton kind="products" label="best sellers" />}>
                <ProductsStream {...stream} />
              </Suspense>
            ),
            channels: (
              <Suspense fallback={<SectionSkeleton kind="channels" label="where sales come from" />}>
                <ChannelsStream {...stream} />
              </Suspense>
            ),
            target: (
              <Suspense fallback={<SectionSkeleton kind="target" label="the target" />}>
                <TargetStream {...stream} />
              </Suspense>
            ),
            forecast: (
              <Suspense fallback={<SectionSkeleton kind="forecast" label="the forecast" />}>
                <ForecastStream {...stream} />
              </Suspense>
            ),
          }}
        />
      </div>
    </ExportScope>
  );
}
