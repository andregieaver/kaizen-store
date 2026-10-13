import type { Metadata } from "next";

import { PeriodPicker } from "@/components/admin/analytics/period-picker";
import { ReportsView } from "@/components/admin/support/reports-view";
import { addDays, parseAnalyticsParams, todayIn } from "@/lib/analytics-period";
import { requirePermission } from "@/server/permissions";
import { memberDesk } from "@/server/support-desk";
import { deskReport } from "@/server/support-reports";

export const metadata: Metadata = { title: "Support reports" };

/** The store's support report (D216, step 14; figures defined in `docs/analytics.md`, Support): `support:read`. */
export default async function SupportReportsPage({ params, searchParams }: PageProps<"/admin/[store]/support/reports">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const staff = memberDesk(member);
  const timeZone = member.store.timeZone;
  const now = new Date();
  const { period, notice } = parseAnalyticsParams(await searchParams, { now, timeZone });
  const { report, cut } = await deskReport(staff.desk, period, timeZone);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Support reports</h1>
        <p className="text-muted">How the store&apos;s conversations went: who answered, how long customers waited, and what they asked about.</p>
      </div>
      {notice && <p className="text-sm">{notice}</p>}
      <ReportsView
        report={report}
        periodLabel={period.label}
        cut={cut}
        picker={<PeriodPicker basePath={`/admin/${slug}/support/reports`} preset={period.preset} from={period.from} to={addDays(period.to, -1)} compare="none" showCompare={false} max={todayIn(now, timeZone)} />}
      />
    </div>
  );
}
