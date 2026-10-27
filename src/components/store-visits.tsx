import { TouchKeeper } from "@/components/lazy/touch-keeper";
import { OffPayRoutes } from "@/components/off-pay-routes";
import { SpeedBeacon } from "@/components/speed-beacon";
import { VisitBeacon } from "@/components/visit-beacon";

/**
 * A store's visit counting (D152), in its layouts, only while the owner has switched it on: the flag comes from the cached
 * store (saving it already refreshes the store's tag), so no page asks the database. Draws nothing but the beacon, and the keeper of a
 * first visit in 30 days, which keeps nothing without statistics consent (D303 I3), and the speed beacon off the pay routes (D336).
 */
export function StoreVisits({ store }: { store: { id: string; slug: string; visitCounting: boolean } }) {
  return store.visitCounting ? (
    <>
      <VisitBeacon store={store.slug} />
      <TouchKeeper store={store.slug} storeId={store.id} />
      {/* How fast the store's pages load for its visitors (D336), never measured on the pay routes. */}
      <OffPayRoutes>
        <SpeedBeacon store={store.slug} />
      </OffPayRoutes>
    </>
  ) : null;
}
