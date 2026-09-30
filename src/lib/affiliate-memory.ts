/**
 * The referral code a visitor arrived with (D131), kept in this page's memory and nowhere else: a module variable, which
 * survives the storefront's client navigations and is gone when the page is loaded again. Nothing is written to a cookie
 * or to storage here; that is `AffiliateCapture`'s, and only once the visitor has allowed it (D58).
 * Keyed by the store's slug, so a code is only ever offered to the store it was for.
 */

let held: { store: string; code: string } | null = null;
const listeners = new Set<() => void>();

/** The code held for this store, or null. */
export function heldAffiliateCode(store: string): string | null {
  return held && held.store === store ? held.code : null;
}

/** Holds a code for a store (null to let go of it), and tells whatever shows it. */
export function holdAffiliateCode(store: string, code: string | null): void {
  const next = code ? { store, code } : null;
  if (held?.store === next?.store && held?.code === next?.code) return;
  held = next;
  for (const listener of listeners) listener();
}

export function subscribeAffiliateCode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
