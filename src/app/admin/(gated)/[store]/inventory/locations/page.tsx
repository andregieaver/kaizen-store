import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { LocationsView } from "@/components/admin/inventory/locations-view";
import { db } from "@/db/client";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { locationImpact } from "@/server/inventory";
import { listLocations } from "@/server/inventory-locations";
import { incomingStock } from "@/server/stock-transfers";
import { memberCan, requirePermission } from "@/server/permissions";
import { listCountries } from "@/server/stores";

import { deactivateLocationAction, moveLocationAction, reactivateLocationAction, saveLocationAction, setOnlineAction } from "./actions";

export const metadata: Metadata = { title: "Stock locations" };

type Props = PageProps<"/admin/[store]/inventory/locations">;

/**
 * The stock locations (wave 3, D172, `docs/wave-3-inventory.md` 2.3): add, rename and rank them (`products:write`), and, for the owner, deactivate or
 * reactivate one after seeing what stops being for sale. Everyone who can read products sees the list. Read per request.
 */
export default async function LocationsPage({ params }: Props) {
  const gated = await requirePermission((await params).store, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "inventory").pages.locations;
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead slug={store.slug} active="locations" title={w.title} intro={w.intro} lang={lang} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug }: { storeSlug: string }) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const [locations, countries, incoming] = await Promise.all([listLocations(store.id), listCountries(), incomingStock(store.id)]);
  // Units on their way to each location (D383): sent transfers and ordered purchase orders not yet counted in.
  const incomingAt = new Map<string, number>();
  for (const [key, units] of incoming) {
    const location = key.split(":")[1];
    incomingAt.set(location, (incomingAt.get(location) ?? 0) + units);
  }
  const isOwner = memberCan(member, "owner");
  // What each active location's deactivation would take off sale, read now for the owner's dialog (the server reads it again when confirmed).
  const impacts = isOwner ? await Promise.all(locations.map((l) => (l.active ? locationImpact(db(), store.id, l.id) : Promise.resolve(null)))) : locations.map(() => null);
  return (
    <AdminTextScope texts={adminTexts(adminLangOf(member.account.adminLocale), ["inventory"])}>
    <LocationsView
      rows={locations.map((l, i) => ({ id: l.id, name: l.name, country: l.country, active: l.active, fulfilsOnline: l.fulfilsOnline, priority: l.priority, units: l.units, variants: l.variants, incoming: incomingAt.get(l.id) ?? 0, impact: impacts[i] }))}
      countries={countries.map((c) => ({ code: c.code, name: c.name }))}
      canWrite={memberCan(member, "products:write")}
      isOwner={isOwner}
      tools={{
        save: saveLocationAction.bind(null, store.slug),
        move: moveLocationAction.bind(null, store.slug),
        deactivate: deactivateLocationAction.bind(null, store.slug),
        reactivate: reactivateLocationAction.bind(null, store.slug),
        online: setOnlineAction.bind(null, store.slug),
      }}
    />
    </AdminTextScope>
  );
}
