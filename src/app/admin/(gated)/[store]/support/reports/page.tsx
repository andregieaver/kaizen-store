import type { Metadata } from "next";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { PeriodPicker } from "@/components/admin/analytics/period-picker";
import { ReportsView } from "@/components/admin/support/reports-view";
import { addDays, parseAnalyticsParams, todayIn } from "@/lib/analytics-period";
import { requirePermission } from "@/server/permissions";
import { memberDesk } from "@/server/support-desk";
import { deskReport } from "@/server/support-reports";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Support reports" };

/** The store's support report (D216, step 14; figures defined in `docs/analytics.md`, Support): `support:read`. */
export default async function SupportReportsPage({
  params,
  searchParams,
}: PageProps<"/admin/[store]/support/reports">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const staff = memberDesk(member);
  const lang = adminLangOf(member.account.adminLocale);
  const t = adminText(lang, "support");
  const timeZone = member.store.timeZone;
  const now = new Date();
  const { period, notice } = parseAnalyticsParams(await searchParams, {
    now,
    timeZone,
  });
  const { report, cut } = await deskReport(staff.desk, period, timeZone);
  return (
    <AdminTextScope texts={adminTexts(lang, ["support"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t.pages.storeReports.title}
          description={t.pages.storeReports.description}
        />
        {notice && <p className="text-sm">{notice}</p>}
        <ReportsView
          words={t}
          report={report}
          periodLabel={period.label}
          cut={cut}
          picker={
            <PeriodPicker
              basePath={`/admin/${slug}/support/reports`}
              preset={period.preset}
              from={period.from}
              to={addDays(period.to, -1)}
              compare="none"
              showCompare={false}
              max={todayIn(now, timeZone)}
            />
          }
        />
      </div>
    </AdminTextScope>
  );
}
