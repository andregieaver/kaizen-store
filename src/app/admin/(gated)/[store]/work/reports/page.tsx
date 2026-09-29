import type { Metadata } from "next";

import { ReportView } from "@/components/admin/work/report-view";
import { WorkOff } from "@/components/admin/work/work-off";
import { todayIn } from "@/lib/work-dates";
import { parseReportParams } from "@/lib/work-reports";
import { requireMember } from "@/server/auth";
import { listClients } from "@/server/work";
import { getPeriodReport } from "@/server/work-reports";

export const metadata: Metadata = { title: "Reports" };

/**
 * Work's reports (docs/work.md 1.9, 5.2, WP9): a period (this month, last month, this quarter, this year or
 * custom days in the store's time zone), by client or by assignment, with hours, unbilled time, drafts,
 * invoiced, paid and outstanding. The settings are in the address (`?period=last_month&by=assignment&client=`),
 * so a view can be linked to, printed (`reports/print`) and downloaded (`reports/csv`).
 */
export default async function WorkReportsPage({ params, searchParams }: PageProps<"/admin/[store]/work/reports">) {
  const { store } = await requireMember((await params).store);
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title="Reports" />;
  const today = todayIn(store.timeZone);
  const settings = parseReportParams(await searchParams, today);
  const [clients, report] = await Promise.all([
    listClients(store.id, { archived: "all" }),
    getPeriodReport(store, {
      from: settings.period.from,
      to: settings.period.to,
      by: settings.by,
      clientId: settings.clientId || null,
    }),
  ]);
  return (
    <ReportView
      storeSlug={store.slug}
      locale={store.markets[0]?.locale ?? "en"}
      today={today}
      params={settings}
      report={report}
      clients={clients.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
