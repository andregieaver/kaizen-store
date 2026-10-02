import { VisitBeacon } from "@/components/visit-beacon";

/**
 * A store's visit counting (D152), in its layouts, only while the owner has switched it on: the flag comes from the cached
 * store (saving it already refreshes the store's tag), so no page asks the database. Draws nothing but the beacon.
 */
export function StoreVisits({ store }: { store: { slug: string; visitCounting: boolean } }) {
  return store.visitCounting ? <VisitBeacon store={store.slug} /> : null;
}
