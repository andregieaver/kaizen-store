"use client";

import { useEffect } from "react";

import type { OwnSpeedSite, SpeedMetric } from "@/lib/speed";
import type { speedRequest } from "@/lib/speed-send";
import { optedOut } from "@/lib/visit-beacon";

/**
 * How fast this page load was for this visitor (D336, `docs/analytics.md` "Speed"), while the store counts visits: the Core Web
 * Vitals measured by `web-vitals` (loaded on its own, after the page), sent once with `navigator.sendBeacon` when the page is hidden
 * (closed, left, put in the background: `visibilitychange`, never `pagehide`, which a browser fires first when a page is left, before
 * `web-vitals` has its final figures), with the path the server turns into the page's kind and whether the screen is a phone's.
 * No cookie, no storage, no identifier; nothing at all with Global Privacy Control or Do Not Track. Never on the pay routes
 * (`StoreVisits` draws it inside `OffPayRoutes`). Draws nothing. With `own`, the page is Kaizena Flow's own site's or the admin's (D390),
 * measured always (it is the platform's own speed, not a store's choice) under the same rules, and sent to its own endpoint.
 * On a store's page under an A/B test it also says which version the page showed (`shownVersions()`, D148 phase 19), as the heatmaps do;
 * the server keeps a version only where the visitor's own A/B cookie confirms it, so the speed guardrail compares versions. What it sends
 * is put together by `speedRequest()` (`lib/speed-send`), loaded with web-vitals after the page has started, not in its first scripts.
 */
export function SpeedBeacon({ store, own }: { store?: string; own?: OwnSpeedSite }) {
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
    let request: typeof speedRequest | null = null;
    // Once, the first time the page is hidden.
    const send = () => {
      if (sent || !request || document.visibilityState !== "hidden") return;
      const beacon = request({ store, own, path, width: window.innerWidth, values });
      if (!beacon) return;
      sent = true;
      try {
        nav.sendBeacon(beacon.url, new Blob([beacon.body], { type: "text/plain" }));
      } catch {
        // Measuring is never worth an error on a page.
      }
    };
    // web-vitals reports its final values from its own listener when the page is hidden; ours is added after it, so it reads them.
    const hidden = () => send();
    Promise.all([import("web-vitals"), import("@/lib/speed-send")])
      .then(([{ onLCP, onINP, onCLS, onTTFB }, sending]) => {
        if (stopped) return;
        request = sending.speedRequest;
        onLCP((m) => (values.lcp = m.value));
        onINP((m) => (values.inp = m.value));
        onCLS((m) => (values.cls = m.value));
        onTTFB((m) => (values.ttfb = m.value));
        document.addEventListener("visibilitychange", hidden);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [store, own]);

  return null;
}
