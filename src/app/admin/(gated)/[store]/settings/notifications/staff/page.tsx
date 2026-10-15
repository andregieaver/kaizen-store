import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { StaffAlertsForm } from "@/components/admin/notifications/staff-alerts-form";
import { PageHeader } from "@/components/admin/ui";
import { requirePermission } from "@/server/permissions";
import { staffAlertsView } from "@/server/staff-alerts";

import { saveStaffAlertsAction, sendStaffTestAction } from "./actions";

export const metadata: Metadata = { title: "Staff alerts" };

/**
 * Who on the team is emailed about the store's orders, returns and stock, and the summary (wave 3, D238, `docs/wave-3-notifications.md` 2.4). The
 * owner's alone: everyone else gets the 404 (D158).
 */
export default async function StaffAlertsPage({ params }: PageProps<"/admin/[store]/settings/notifications/staff">) {
  const member = await requirePermission((await params).store, "owner");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const view = await staffAlertsView(store.id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/settings/notifications`, label: "Notifications" }}
        title="Staff alerts"
        description={<>Choose who on the team is emailed when an order is paid, a customer asks to return something, a refund is overdue or stock runs low, and who gets a daily or weekly summary. Staff emails are in English.</>}
      />
      <StaffAlertsForm view={view} save={saveStaffAlertsAction.bind(null, store.slug)} test={sendStaffTestAction.bind(null, store.slug)} />
    </div>
  );
}
