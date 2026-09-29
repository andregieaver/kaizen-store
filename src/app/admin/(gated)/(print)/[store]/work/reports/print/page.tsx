import type { Metadata } from "next";

import { DocumentPage } from "@/components/admin/work/document-page";
import { ReportPrintView } from "@/components/admin/work/report-print";
import { WorkOff } from "@/components/admin/work/work-off";
import { todayIn } from "@/lib/work-dates";
import { parseReportParams, reportFileName, reportQuery } from "@/lib/work-reports";
import { requireMember } from "@/server/auth";
import { getPeriodReport } from "@/server/work-reports";

export const metadata: Metadata = { title: "Print report", robots: { index: false, follow: false } };

/**
 * A Work report to print or save as PDF (docs/work.md 5.2, WP9): the same settings as the reports page, read
 * from the address, drawn in landscape without the admin around it (the `(print)` route group has no store
 * layout; the gated layout above it still checks the session, and this page checks the store). `?auto=1`
 * opens the print dialog by itself.
 */
export default async function ReportPrintPage({
  params,
  searchParams,
}: PageProps<"/admin/[store]/work/reports/print">) {
  const { store } = await requireMember((await params).store);
  if (!store.workOn) {
    return (
      <div className="p-8">
        <WorkOff storeSlug={store.slug} title="Reports" />
      </div>
    );
  }
  const search = await searchParams;
  const today = todayIn(store.timeZone);
  const settings = parseReportParams(search, today);
  const report = await getPeriodReport(store, {
    from: settings.period.from,
    to: settings.period.to,
    by: settings.by,
    clientId: settings.clientId || null,
  });
  return (
    <DocumentPage
      backHref={`/admin/${store.slug}/work/reports${reportQuery(settings)}`}
      backLabel="Back to reports"
      documentTitle={reportFileName(store.slug, report).replace(/\.csv$/, "")}
      auto={search.auto === "1"}
    >
      <ReportPrintView
        storeName={store.name}
        locale={store.markets[0]?.locale ?? "en"}
        today={today}
        report={report}
      />
    </DocumentPage>
  );
}
