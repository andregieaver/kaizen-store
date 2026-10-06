import type { Metadata } from "next";
import { Suspense } from "react";

import { DataSkeleton } from "@/components/admin/data/page-parts";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { LocationsView } from "@/components/admin/inventory/locations-view";
import { db } from "@/db/client";
import { locationImpact } from "@/server/inventory";
import { listLocations } from "@/server/inventory-locations";
import { memberCan, requirePermission } from "@/server/permissions";
import { listCountries } from "@/server/stores";

import { deactivateLocationAction, moveLocationAction, reactivateLocationAction, saveLocationAction } from "./actions";

export const metadata: Metadata = { title: "Stock locations" };

type Props = PageProps<"/admin/[store]/inventory/locations">;

/**
 * The stock locations (wave 3, D172, `docs/wave-3-inventory.md` 2.3): add, rename and rank them (`products:write`), and, for the owner, deactivate or
 * reactivate one after seeing what stops being for sale. Everyone who can read products sees the list. Read per request.
 */
export default async function LocationsPage({ params }: Props) {
  const { store } = await requirePermission((await params).store, "products:read");
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead
        slug={store.slug}
        active="locations"
        title="Stock locations"
        intro="The places your stock is held. Each variant has its own stock at each location, and the shop sells the sum of the active ones. The order below is the order orders are taken in."
      />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug }: { storeSlug: string }) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const [locations, countries] = await Promise.all([listLocations(store.id), listCountries()]);
  const isOwner = memberCan(member, "owner");
  // What each active location's deactivation would take off sale, read now for the owner's dialog (the server reads it again when confirmed).
  const impacts = isOwner ? await Promise.all(locations.map((l) => (l.active ? locationImpact(db(), store.id, l.id) : Promise.resolve(null)))) : locations.map(() => null);
  return (
    <LocationsView
      rows={locations.map((l, i) => ({ id: l.id, name: l.name, country: l.country, active: l.active, priority: l.priority, units: l.units, variants: l.variants, impact: impacts[i] }))}
      countries={countries.map((c) => ({ code: c.code, name: c.name }))}
      canWrite={memberCan(member, "products:write")}
      isOwner={isOwner}
      tools={{
        save: saveLocationAction.bind(null, store.slug),
        move: moveLocationAction.bind(null, store.slug),
        deactivate: deactivateLocationAction.bind(null, store.slug),
        reactivate: reactivateLocationAction.bind(null, store.slug),
      }}
    />
  );
}
