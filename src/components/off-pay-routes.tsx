"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { isPayPath } from "@/lib/pay-routes";

/**
 * Draws its children everywhere but on the cart, checkout and order (wave 1, 1e, `docs/wave-1-trust.md` 2.5, `docs/pci.md`), where a
 * shopper types a card and nothing another site's code can come in through may run: the market layout puts the assistant, referral
 * capture, the business popup and the consent banner (with the tracking tools and owner code it loads) in here. The address decides, on
 * the server for a page loaded afresh and in the browser for a client navigation, so what stays across the store's other pages stays
 * (an open chat, a banner not yet answered) and a pay page never has it. Children that are not drawn are never hydrated, so nothing in
 * them runs.
 *
 * A client navigation into a pay route unmounts them here, but a script they added earlier is still in the document: that is what
 * `PayRouteGuard` (`pay-route-guard.tsx`) reloads for.
 */
export function OffPayRoutes({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return isPayPath(pathname) ? null : children;
}
