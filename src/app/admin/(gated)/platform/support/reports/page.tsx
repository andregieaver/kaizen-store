import type { Metadata } from "next";

import { PeriodPicker } from "@/components/admin/analytics/period-picker";
import { ReportsView } from "@/components/admin/support/reports-view";
import { addDays, parseAnalyticsParams, todayIn } from "@/lib/analytics-period";
import { kaizenDesk } from "@/server/support-desk";
import { KAIZEN_TIME_ZONE, deskReport } from "@/server/support-reports";

export const metadata: Metadata = { title: "Support reports" };

/** Kaizen's own desk's report (D216, step 14): its visitors' and owners' conversations, in Europe/Oslo's days. */
export default async function KaizenSupportReportsPage({ searchParams }: PageProps<"/admin/platform/support/reports">) {
  const staff = await kaizenDesk();
  const now = new Date();
  const { period, notice } = parseAnalyticsParams(await searchParams, { now, timeZone: KAIZEN_TIME_ZONE });
  const { report, cut } = await deskReport(staff.desk, period, KAIZEN_TIME_ZONE);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Support reports</h1>
        <p className="text-muted">How Kaizen&apos;s own desk did: visitors of Kaizen&apos;s site and owners asking Kaizen.</p>
      </div>
      {notice && <p className="text-sm">{notice}</p>}
      <ReportsView
        report={report}
        periodLabel={period.label}
        cut={cut}
        picker={<PeriodPicker basePath="/admin/platform/support/reports" preset={period.preset} from={period.from} to={addDays(period.to, -1)} compare="none" showCompare={false} max={todayIn(now, KAIZEN_TIME_ZONE)} />}
      />
    </div>
  );
}
