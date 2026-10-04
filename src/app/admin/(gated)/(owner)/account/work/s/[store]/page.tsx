import type { Metadata } from "next";

import { OverviewBody } from "@/components/admin/work/work-overview";
import { WorkOff } from "@/components/admin/work/work-off";
import { getWorkOverview } from "@/server/work-overview";
import { workReadiness } from "@/server/work-settings";
import { workBase } from "@/lib/work-paths";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Work" };

/** Work (D122): what is unbilled, drafted and owed, what needs attention, and what is running. */
export default async function WorkPage({ params }: PageProps<"/admin/account/work/s/[store]">) {
  const { store } = await requirePermission((await params).store, "settings:read");
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title="Work" />;
  const base = workBase(store.slug);
  const [view, readiness] = await Promise.all([getWorkOverview(store), workReadiness(store.id)]);
  return (
    <OverviewBody
      base={base}
      settingsHref={`${workBase(store.slug)}/settings`}
      locale={store.markets[0]?.locale ?? "en"}
      today={view.today}
      overview={view.overview}
      clientCount={view.clientCount}
      clientNames={view.clientNames}
      invoiceNumbers={view.invoiceNumbers}
      assignmentNames={view.assignmentNames}
      people={view.people}
      missing={readiness.problems}
    />
  );
}
