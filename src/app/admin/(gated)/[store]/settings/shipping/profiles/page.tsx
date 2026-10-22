import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { ProfilesView } from "@/components/admin/shipping/profiles-view";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { AdminTextScope } from "@/components/admin/admin-text";
import { memberCan, requirePermission } from "@/server/permissions";
import { listProfileProducts } from "@/server/shipping-admin";
import { getShippingSetup } from "@/server/shipping-methods";

import { deleteProfileAction, saveProfileAction } from "../actions";

export const metadata: Metadata = { title: "Shipping profiles" };

/** Shipping profiles and their products (D237 2.1). */
export default async function ShippingProfilesPage({ params }: PageProps<"/admin/[store]/settings/shipping/profiles">) {
  const gated = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const all = adminText(lang, "shipping");
  const base = `/admin/${store.slug}/settings/shipping`;
  const [setup, products] = await Promise.all([getShippingSetup(store.id), listProfileProducts(store)]);
  return (
    <AdminTextScope texts={adminTexts(lang, ["shipping"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: all.pages.back }}
        title={all.pages.profilesTitle}
        description={all.pages.profilesDescription}
      />
      <ProfilesView
        profiles={setup.profiles}
        products={products}
        canWrite={memberCan(gated, "settings:write")}
        words={all.profiles}
        save={(profileId) => saveProfileAction.bind(null, store.slug, profileId)}
        remove={(profileId) => deleteProfileAction.bind(null, store.slug, profileId)}
      />
    </div>
    </AdminTextScope>
  );
}
