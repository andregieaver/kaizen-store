import type { Metadata } from "next";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { PeriodPicker } from "@/components/admin/analytics/period-picker";
import { ReportsView } from "@/components/admin/support/reports-view";
import { addDays, parseAnalyticsParams, todayIn } from "@/lib/analytics-period";
import { kaizenDesk } from "@/server/support-desk";
import { KAIZEN_TIME_ZONE, deskReport } from "@/server/support-reports";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Support reports" };

/** Kaizen's own desk's report (D216, step 14): its visitors' and owners' conversations, in Europe/Oslo's days. */
export default async function KaizenSupportReportsPage({
  searchParams,
}: PageProps<"/admin/platform/support/reports">) {
  const staff = await kaizenDesk();
  const lang = adminLangOf(staff.account.adminLocale);
  const t = adminText(lang, "support");
  const now = new Date();
  const { period, notice } = parseAnalyticsParams(await searchParams, {
    now,
    timeZone: KAIZEN_TIME_ZONE,
  });
  const { report, cut } = await deskReport(
    staff.desk,
    period,
    KAIZEN_TIME_ZONE,
  );
  return (
    <AdminTextScope texts={adminTexts(lang, ["support"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t.pages.platformReports.title}
          description={t.pages.platformReports.description}
        />
        {notice && <p className="text-sm">{notice}</p>}
        <ReportsView
          words={t}
          report={report}
          periodLabel={period.label}
          cut={cut}
          picker={
            <PeriodPicker
              basePath="/admin/platform/support/reports"
              preset={period.preset}
              from={period.from}
              to={addDays(period.to, -1)}
              compare="none"
              showCompare={false}
              max={todayIn(now, KAIZEN_TIME_ZONE)}
            />
          }
        />
      </div>
    </AdminTextScope>
  );
}
