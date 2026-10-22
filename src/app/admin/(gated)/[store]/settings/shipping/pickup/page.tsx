import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { PickupView } from "@/components/admin/shipping/pickup-view";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { memberCan, requirePermission } from "@/server/permissions";
import { listPickupPlaces } from "@/server/pickup";

import { savePickupAction } from "../actions";

export const metadata: Metadata = { title: "Pickup" };

/** Pickup at the store's own places (D237 2.2). */
export default async function ShippingPickupPage({ params }: PageProps<"/admin/[store]/settings/shipping/pickup">) {
  const gated = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const all = adminText(lang, "shipping");
  const base = `/admin/${store.slug}/settings/shipping`;
  const places = await listPickupPlaces(store.id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: all.pages.back }}
        title={all.pages.pickupTitle}
        description={all.pages.pickupDescription}
      />
      <PickupView
        places={places}
        companyHref={`/admin/${store.slug}/settings/company`}
        canWrite={memberCan(gated, "settings:write")}
        words={all.pickup}
        save={(place) => savePickupAction.bind(null, store.slug, place.locationId, place.currency ?? "")}
      />
    </div>
  );
}
