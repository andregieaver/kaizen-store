import type { Metadata } from "next";

import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { AnalyticsSettingsView } from "@/components/admin/analytics/settings-forms";
import { todayIn } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";
import { analyticsContext } from "@/server/analytics-context";
import { analyticsSetupSummary } from "@/server/analytics-settings-data";
import { listTargets } from "@/server/analytics-settings";

import {
  backfillCostsAction,
  deleteTargetAction,
  saveAnalyticsSettingsAction,
  saveTargetAction,
  setVisitCountingAction,
} from "./actions";

export const metadata: Metadata = { title: "Analytics settings" };

/**
 * What turns sales into profit and what is counted about visitors (D152, `docs/analytics.md`): the cost of goods, the fees and
 * costs the store cannot see, a customer's lifetime, monthly revenue targets and visit counting. The owner's; any other member
 * sees how it is set up and is told who can change it. The page loads and the view draws.
 */
export default async function AnalyticsSettingsPage({ params }: PageProps<"/admin/[store]/analytics/settings">) {
  const ctx = await analyticsContext((await params).store, {});
  const { store, role, settings, base, now } = ctx;
  const [summary, targets] = await Promise.all([analyticsSetupSummary(store.id), listTargets(store.id, 60)]);
  const owner = role === "owner";
  return (
    <div className="flex flex-col gap-6">
      <AnalyticsHeader
        ctx={ctx}
        path="/analytics/settings"
        title="Analytics settings"
        description="What your products cost, the fees we cannot see, what you are aiming for, and whether visits are counted. These turn sales figures into profit."
        picker={false}
      />
      <AnalyticsSettingsView
        base={base}
        currency={mainCurrency(store)}
        locale={store.markets[0]?.locale ?? "en"}
        today={todayIn(now, store.timeZone)}
        settings={settings}
        summary={summary}
        targets={targets}
        visitCounting={store.visitCounting}
        actions={
          owner
            ? {
                saveSettings: saveAnalyticsSettingsAction.bind(null, store.slug),
                saveTarget: saveTargetAction.bind(null, store.slug),
                deleteTarget: deleteTargetAction.bind(null, store.slug),
                setVisitCounting: setVisitCountingAction.bind(null, store.slug),
                backfillCosts: backfillCostsAction.bind(null, store.slug),
              }
            : null
        }
      />
    </div>
  );
}
