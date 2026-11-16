import { idsKey, idsOf, readSession, sessionKey } from "@/lib/recording";

/**
 * Deletes a visitor's recordings of visits on one store (D656, `docs/heatmaps-and-recordings.md` 8.3): the ids this browser kept, and the
 * tab's own, in one beacon, then both storage keys are cleared. Used when recordings are withdrawn, when leftover ids are found without
 * consent, and by the Cookies page's *Delete my recordings*. Light (no rrweb) and synchronous: the banner reloads the page in the same task.
 */
export function forgetRecordings(store: { id: string; slug: string }): boolean {
  try {
    const local = window.localStorage;
    const tab = window.sessionStorage;
    const ids = new Set(idsOf(local.getItem(idsKey(store.id))));
    const current = readSession(tab.getItem(sessionKey(store.id)));
    if (current) ids.add(current.id);
    local.removeItem(idsKey(store.id));
    tab.removeItem(sessionKey(store.id));
    if (ids.size === 0) return true;
    return navigator.sendBeacon("/api/signals/forget", new Blob([JSON.stringify({ store: store.slug, ids: [...ids].slice(0, 51) })], { type: "text/plain" }));
  } catch {
    return false;
  }
}

/** Whether this browser holds ids of recordings on the store. */
export function hasRecordingIds(storeId: string): boolean {
  try {
    return idsOf(window.localStorage.getItem(idsKey(storeId))).length > 0;
  } catch {
    return false;
  }
}
