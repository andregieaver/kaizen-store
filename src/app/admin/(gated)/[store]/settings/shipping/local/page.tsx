import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { LocalView } from "@/components/admin/shipping/local-view";
import { PageHeader } from "@/components/admin/ui";
import { getCompany } from "@/server/company";
import { codesInRadius, hasPostalPoints, listLocalAreas } from "@/server/local-delivery";
import { memberCan, requirePermission } from "@/server/permissions";

import { checkLocalCodeAction, deleteAreaAction, saveAreaAction } from "../actions";

export const metadata: Metadata = { title: "Local delivery" };

/** Local delivery areas (D237 2.3). */
export default async function ShippingLocalPage({ params }: PageProps<"/admin/[store]/settings/shipping/local">) {
  const gated = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const base = `/admin/${store.slug}/settings/shipping`;
  const [areas, company, withPoints] = await Promise.all([
    listLocalAreas(store.id),
    getCompany(store.id),
    Promise.all(store.markets.map(async (m) => ((await hasPostalPoints(m.code)) ? m.code : null))),
  ]);
  const places = [company.office, ...company.places].filter((p) => p !== null);
  // How many of the country's postal codes each circle includes (the page says it, since centres are coarse).
  const included = await Promise.all(areas.map((a) => (a.kind === "radius" && a.origin && a.radiusKm ? codesInRadius(a.marketCode, a.origin, a.radiusKm) : Promise.resolve(null))));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: "Shipping" }}
        title="Local delivery"
        description="Deliver orders yourself to customers nearby. Customers give their postal code at checkout and are offered the cheapest area that covers it, with a note for the driver. Mark an order Out for delivery to email them, and Delivered when it is there."
      />
      <LocalView
        markets={store.markets.map((m) => ({ code: m.code, name: m.name, currency: m.nativeCurrency }))}
        areas={areas.map((a, i) => ({ ...a, included: included[i] }))}
        places={places.map((p) => ({ id: p.id, name: p.kind === "office" ? p.name || "Office" : p.name, country: p.country, hasPosition: p.latitude !== null }))}
        radiusCountries={withPoints.filter((c): c is string => c !== null)}
        canWrite={memberCan(gated, "settings:write")}
        save={(areaId) => saveAreaAction.bind(null, store.slug, areaId)}
        remove={(areaId) => deleteAreaAction.bind(null, store.slug, areaId)}
        check={memberCan(gated, "settings:write") ? checkLocalCodeAction.bind(null, store.slug) : null}
      />
    </div>
  );
}
