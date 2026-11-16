"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { beaconBody, optedOut, PAGE_ERROR_ENDPOINT, shouldSend, VISIT_ENDPOINT, type Debounce } from "@/lib/visit-beacon";

/** The store whose visit beacon runs on this page, for the error page to name (it gets no props); null where visits are not counted. */
let beaconStore: string | null = null;

function privacyOptOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return optedOut({
    globalPrivacyControl: nav.globalPrivacyControl,
    doNotTrack: nav.doNotTrack,
    windowDoNotTrack: (window as Window & { doNotTrack?: string }).doNotTrack,
    msDoNotTrack: nav.msDoNotTrack,
  });
}

/**
 * Says a store page failed to render (F4, D663), once per page: the store and the path, as a page view's body, so the server marks the
 * visitor's counted visit of the day with the time of its first error. Nothing where the store does not count visits or the browser asks not
 * to be tracked; never worth an error itself.
 */
export function reportPageError(): void {
  try {
    if (!beaconStore || privacyOptOut() || typeof navigator.sendBeacon !== "function") return;
    const body = beaconBody({ store: beaconStore, path: window.location.pathname, search: "", referrer: "", ownHost: window.location.host, first: false });
    if (body) navigator.sendBeacon(PAGE_ERROR_ENDPOINT, new Blob([body], { type: "text/plain" }));
  } catch {
    // Saying so is never worth an error on the error page.
  }
}

/**
 * Counts a page view without a cookie or any storage (D152, docs/analytics.md, "Visit counting"). It draws nothing. When a
 * page opens, and on each client navigation after it, it sends the page's path with `navigator.sendBeacon` (a plain-text
 * body, so no pre-flight): the referring site's host and the campaign tags only on the first page view of a page load.
 * It sends nothing when the browser says Global Privacy Control or Do Not Track, and nothing twice for one path within a
 * moment. What it sends and when is `src/lib/visit-beacon.ts`, which is tested; the server decides what is counted.
 */
export function VisitBeacon({ store }: { store: string }) {
  const pathname = usePathname();
  const first = useRef(true);
  const last = useRef<Debounce>(null);

  useEffect(() => {
    beaconStore = store;
    return () => {
      if (beaconStore === store) beaconStore = null;
    };
  }, [store]);

  useEffect(() => {
    try {
      const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
      if (privacyOptOut()) return;
      // The address as the browser has it: what the router calls the path can be an internal one behind a host's rewrite.
      const path = window.location.pathname;
      const now = Date.now();
      if (!shouldSend(last.current, path, now)) return;
      const body = beaconBody({ store, path, search: window.location.search, referrer: document.referrer, ownHost: window.location.host, first: first.current });
      if (!body || typeof nav.sendBeacon !== "function") return;
      last.current = { path, at: now };
      first.current = false;
      nav.sendBeacon(VISIT_ENDPOINT, new Blob([body], { type: "text/plain" }));
    } catch {
      // Counting is never worth an error on a page.
    }
  }, [pathname, store]);

  return null;
}
