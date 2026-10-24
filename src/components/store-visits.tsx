import { TouchKeeper } from "@/components/lazy/extras";
import { VisitBeacon } from "@/components/visit-beacon";

/**
 * A store's visit counting (D152), in its layouts, only while the owner has switched it on: the flag comes from the cached
 * store (saving it already refreshes the store's tag), so no page asks the database. Draws nothing but the beacon, and the keeper of a
 * first visit in 30 days, which keeps nothing without statistics consent (D303 I3).
 */
export function StoreVisits({ store }: { store: { id: string; slug: string; visitCounting: boolean } }) {
  return store.visitCounting ? (
    <>
      <VisitBeacon store={store.slug} />
      <TouchKeeper store={store.slug} storeId={store.id} />
    </>
  ) : null;
}
