import type { Metadata } from "next";

import { PeriodPicker } from "@/components/admin/analytics/period-picker";
import { StoreTotalsView } from "@/components/admin/support/store-totals-view";
import { addDays, parseAnalyticsParams, todayIn } from "@/lib/analytics-period";
import { requirePlatformAdmin } from "@/server/auth";
import { storeTotals } from "@/server/support-platform";
import { KAIZEN_TIME_ZONE } from "@/server/support-reports";

export const metadata: Metadata = { title: "Stores' support" };

/**
 * The stores' support in figures (D216, 2.8 *Stores*, step 14): per store, counts and rates only. A platform admin never reads a
 * store's conversations: nothing here links to one.
 */
export default async function StoresSupportPage({ searchParams }: PageProps<"/admin/platform/support/stores">) {
  await requirePlatformAdmin();
  const now = new Date();
  const { period, notice } = parseAnalyticsParams(await searchParams, { now, timeZone: KAIZEN_TIME_ZONE });
  const { stores, cut } = await storeTotals(period);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Stores&apos; support</h1>
        <p className="text-muted">Each store&apos;s support desk in figures: counts and rates only, never a conversation.</p>
      </div>
      {notice && <p className="text-sm">{notice}</p>}
      <PeriodPicker basePath="/admin/platform/support/stores" preset={period.preset} from={period.from} to={addDays(period.to, -1)} compare="none" showCompare={false} max={todayIn(now, KAIZEN_TIME_ZONE)} />
      <StoreTotalsView stores={stores} cut={cut} periodLabel={period.label} />
    </div>
  );
}
