import type { Metadata } from "next";

import { OrderSettingsForm } from "@/components/admin/orders/settings-form";
import { getOrderSettings } from "@/server/order-settings";
import { memberCan, requirePermission } from "@/server/permissions";

import { saveOrderSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Orders settings" };

/**
 * How the store handles orders (wave 3, D173): gift messages, automatic archiving, how long a draft order's pay link is valid, and who may record money taken outside Kaizen.
 * Everyone who may read settings sees them; `settings:write` changes them, and the last choice is the owner's alone.
 */
export default async function OrderSettingsPage({ params }: PageProps<"/admin/[store]/settings/orders">) {
  const member = await requirePermission((await params).store, "settings:read");
  const settings = await getOrderSettings(member.store.id);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-sm text-muted">
          How the store handles orders after they are placed: whether shoppers can send a gift message, whether finished orders are archived for you, and how draft orders are paid.
        </p>
      </div>
      <OrderSettingsForm
        settings={settings}
        canEdit={memberCan(member, "settings:write")}
        isOwner={memberCan(member, "owner")}
        action={saveOrderSettingsAction.bind(null, member.store.slug)}
      />
    </div>
  );
}
