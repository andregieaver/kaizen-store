import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { OrderSettingsForm } from "@/components/admin/orders/settings-form";
import { getOrderSettings } from "@/server/order-settings";
import { memberCan, requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { saveOrderSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Orders settings" };

/**
 * How the store handles orders (wave 3, D173): gift messages, automatic archiving, how long a draft order's pay link is valid, and who may record money taken outside Kaizen.
 * Everyone who may read settings sees them; `settings:write` changes them, and the last choice is the owner's alone.
 */
export default async function OrderSettingsPage({ params }: PageProps<"/admin/[store]/settings/orders">) {
  const member = await requirePermission((await params).store, "settings:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "payments").orders;
  const settings = await getOrderSettings(member.store.id);
  return (
    <AdminTextScope texts={adminTexts(lang, ["payments"])}>
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.intro} />
      <OrderSettingsForm
        settings={settings}
        canEdit={memberCan(member, "settings:write")}
        isOwner={memberCan(member, "owner")}
        action={saveOrderSettingsAction.bind(null, member.store.slug)}
      />
    </div>
    </AdminTextScope>
  );
}
