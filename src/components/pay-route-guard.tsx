"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { heldAffiliateCode } from "@/lib/affiliate-memory";
import { withAffiliate } from "@/lib/affiliate-address";
import { isNoExtrasPath } from "@/lib/pay-routes";

/**
 * Every entry into the cart, checkout or order is a full page load (wave 1, 1e, `docs/wave-1-trust.md` 2.5, `docs/pci.md`): a script
 * the consent manager, the assistant or the owner's own code added to the document on an earlier page stays there after a client
 * navigation, and the pay routes are where a card is typed. So:
 *
 * - `PayDocumentWatcher`, in the market layout, notes that this document has been on a page that is not a pay route, and
 * - `PayRouteGuard`, on the cart, checkout and order pages, reloads the document once if it has.
 *
 * The cart's slide-out on phones is not a pay page (it draws over the page the shopper was on) and is left alone; its checkout button
 * goes on with a full load. A friend's referral code that is held only in the page's memory (D131: nothing is stored before the visitor
 * allows marketing cookies) is carried across the reload in the address, as the capture does for links that leave the market, and
 * so is not lost on the way to the cart. The memory is this document's own, a module variable: nothing is stored, and a reload starts clean, so
 * it cannot loop.
 */
let leftPayRoutes = false;

/** Notes where the document is; true when it has been outside the pay routes. */
export function notePath(pathname: string): boolean {
  if (!isNoExtrasPath(pathname)) leftPayRoutes = true;
  return leftPayRoutes;
}

/** Whether a pay page just drawn must be loaded afresh. */
export const mustReload = (): boolean => leftPayRoutes;

/** Forgets the document's history (tests). */
export function forgetPaths(): void {
  leftPayRoutes = false;
}

export function PayDocumentWatcher() {
  const pathname = usePathname();
  useEffect(() => {
    notePath(pathname);
  }, [pathname]);
  return null;
}

/** Where a pay page is loaded afresh: its own address, with the store's held referral code in it when there is one (and the address has none). */
export function reloadAddress(href: string, origin: string, store: string | null): string {
  const code = store ? heldAffiliateCode(store) : null;
  if (!code) return href;
  const url = new URL(href, origin);
  if (url.searchParams.has("ref")) return href;
  return withAffiliate(href, origin, code);
}

export function PayRouteGuard({ store }: { store?: string }) {
  useEffect(() => {
    if (!mustReload()) return;
    const next = reloadAddress(window.location.href, window.location.origin, store ?? null);
    if (next === window.location.href) window.location.reload();
    else window.location.replace(next);
  }, [store]);
  return null;
}
