"use client";

import { useEffect } from "react";

import { captureAffiliateAction } from "@/app/s/[store]/affiliate-actions";
import { startCapture, type ClickLike } from "@/lib/affiliate-capture";

/**
 * Takes a friend's referral code from the address (`?ref=`) when a store's page opens (D131). Store pages are prerendered,
 * so the server cannot read the address; this does, in the browser (`startCapture()`):
 * - the code is asked of the server once (it says whether it is a live affiliate's and counts the visit, nothing more);
 * - a live code is held in this page's memory, where the forms that add to the cart or register pick it up;
 * - only if the visitor has allowed marketing cookies (D58) is it also written to the store's referral cookie, for the days
 *   the owner chose; if they choose later, it is written then. Nothing is stored before consent;
 * - links that leave the market's own pages (another market, the country chooser) carry it in their address, because each
 *   market is its own page load and memory would be lost.
 * Draws nothing. `base` is the market's own path (null on the country chooser), `scope` the store's.
 */
export function AffiliateCapture({
  storeId,
  storeSlug,
  days,
  base,
  scope,
}: {
  storeId: string;
  storeSlug: string;
  days: number;
  base: string | null;
  scope: string;
}) {
  useEffect(
    () =>
      startCapture(
        {
          search: location.search,
          origin: location.origin,
          pathname: location.pathname,
          secure: location.protocol === "https:",
          readCookies: () => document.cookie,
          writeCookie: (cookie) => {
            document.cookie = cookie;
          },
          addListener: (type, listener, capture) => {
            const target: EventTarget = type === "click" ? document : window;
            const handler = (event: Event) => {
              if (type !== "click") return (listener as () => void)();
              const mouse = event as MouseEvent;
              const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
              const click: ClickLike = {
                defaultPrevented: mouse.defaultPrevented,
                button: mouse.button,
                metaKey: mouse.metaKey,
                ctrlKey: mouse.ctrlKey,
                shiftKey: mouse.shiftKey,
                altKey: mouse.altKey,
                anchor: anchor ? { href: anchor.href, target: anchor.target, download: anchor.hasAttribute("download") } : null,
                preventDefault: () => mouse.preventDefault(),
                stopPropagation: () => mouse.stopPropagation(),
              };
              (listener as (event: ClickLike) => void)(click);
            };
            target.addEventListener(type, handler, capture);
            return () => target.removeEventListener(type, handler, capture);
          },
          navigate: (href) => location.assign(href),
        },
        { storeId, storeSlug, days, base, scope, verify: (code) => captureAffiliateAction(storeSlug, code) },
      ),
    [storeId, storeSlug, days, base, scope],
  );
  return null;
}
