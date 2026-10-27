import type { Metadata } from "next";

import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { SpeedView } from "@/components/admin/analytics/speed-view";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminText, adminTexts } from "@/lib/admin-text";
import { queryText } from "@/lib/analytics-export";
import { analyticsContext } from "@/server/analytics-context";
import { speedReport } from "@/server/analytics-speed";

export const metadata: Metadata = { title: "Speed" };

/**
 * How fast the store's pages load for its visitors (wave 7 unit B, D336, `docs/analytics.md` "Speed"): the last 28 days, whatever period is
 * picked elsewhere, so the page has no period picker. Thin on purpose: it reads the report and hands it to `SpeedView`.
 */
export default async function AnalyticsSpeedPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/speed">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const report = await speedReport(ctx.store);
  const words = adminText(ctx.lang, "analytics");
  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["analytics"])}>
      <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport}>
        <div className="flex flex-col gap-8">
          <AnalyticsHeader ctx={ctx} path="/analytics/speed" title={words.speed.title} description={words.speed.description} picker={false} showCompare={false} />
          <SpeedView base={ctx.base} locale={ctx.locale} report={report} words={words} />
        </div>
      </ExportScope>
    </AdminTextScope>
  );
}
