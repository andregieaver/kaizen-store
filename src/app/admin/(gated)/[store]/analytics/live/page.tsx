import type { Metadata } from "next";

import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { LiveRefresh } from "@/components/admin/analytics/live-refresh";
import { LiveView } from "@/components/admin/analytics/live-view";
import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { adminText, adminTexts } from "@/lib/admin-text";
import { analyticsContext } from "@/server/analytics-context";
import { LIVE_REFRESH_MS, liveFigures } from "@/server/analytics-live";

export const metadata: Metadata = { title: "Live" };

/**
 * Analytics → Live (wave 8 unit C, D347): the figures of `liveFigures()`, read on each request and again every 10 seconds while the tab is
 * shown (`LiveRefresh`). It has no period: it is always now and today.
 */
export default async function AnalyticsLivePage({ params, searchParams }: PageProps<"/admin/[store]/analytics/live">) {
  const ctx = await analyticsContext((await params).store, await searchParams);
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  const words = adminText(ctx.lang, "analytics");
  const live = await liveFigures(ctx.store, ctx.now);
  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["analytics"])}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader ctx={ctx} path="/analytics/live" title={words.live.title} description={words.live.description} picker={false} showCompare={false} />
        <LiveView base={ctx.base} locale={ctx.locale} live={live} words={words} />
        <LiveRefresh every={LIVE_REFRESH_MS} />
      </div>
    </AdminTextScope>
  );
}
