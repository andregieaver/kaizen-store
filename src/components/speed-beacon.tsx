"use client";

import { useEffect } from "react";

import { SPEED_ENDPOINT, speedBody, type SpeedMetric } from "@/lib/speed";
import { optedOut } from "@/lib/visit-beacon";

/**
 * How fast this page load was for this visitor (D336, `docs/analytics.md` "Speed"), while the store counts visits: the Core Web
 * Vitals measured by `web-vitals` (loaded on its own, after the page), sent once with `navigator.sendBeacon` when the page is hidden
 * (closed, left, put in the background), with the path the server turns into the page's kind and whether the screen is a phone's.
 * No cookie, no storage, no identifier; nothing at all with Global Privacy Control or Do Not Track. Never on the pay routes
 * (`StoreVisits` draws it inside `OffPayRoutes`). Draws nothing.
 */
export function SpeedBeacon({ store }: { store: string }) {
  useEffect(() => {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
    try {
      if (
        optedOut({
          globalPrivacyControl: nav.globalPrivacyControl,
          doNotTrack: nav.doNotTrack,
          windowDoNotTrack: (window as Window & { doNotTrack?: string }).doNotTrack,
          msDoNotTrack: nav.msDoNotTrack,
        }) ||
        typeof nav.sendBeacon !== "function"
      )
        return;
    } catch {
      return;
    }
    // The page this load opened on: a later client navigation is another page, which this load's figures do not describe.
    const path = window.location.pathname;
    const values: Partial<Record<SpeedMetric, number>> = {};
    let sent = false;
    let stopped = false;
    // Once, when the page is hidden; a page being left counts as hidden (Safari can fire `pagehide` while still "visible").
    const send = (leaving: boolean) => {
      if (sent || (!leaving && document.visibilityState !== "hidden")) return;
      const body = speedBody({ store, path, width: window.innerWidth, values });
      if (!body) return;
      sent = true;
      try {
        nav.sendBeacon(SPEED_ENDPOINT, new Blob([body], { type: "text/plain" }));
      } catch {
        // Measuring is never worth an error on a page.
      }
    };
    // web-vitals reports its final values from its own listener when the page is hidden; ours is added after it, so it reads them.
    const hidden = (event: Event) => send(event.type === "pagehide");
    import("web-vitals")
      .then(({ onLCP, onINP, onCLS, onTTFB }) => {
        if (stopped) return;
        onLCP((m) => (values.lcp = m.value));
        onINP((m) => (values.inp = m.value));
        onCLS((m) => (values.cls = m.value));
        onTTFB((m) => (values.ttfb = m.value));
        document.addEventListener("visibilitychange", hidden);
        window.addEventListener("pagehide", hidden);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", hidden);
    };
  }, [store]);

  return null;
}
