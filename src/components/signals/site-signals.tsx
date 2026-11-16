"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo } from "react";

import { adminReturnPath, handedOffPath } from "@/lib/admin-return";
import type { Breakpoints } from "@/lib/breakpoints";
import { CONSENT_CHANGED_EVENT, consentCookieName, decodeConsent, versionHas } from "@/lib/cookie-consent";
import { deviceClass } from "@/lib/page-heat";
import { signalPlace } from "@/lib/signal-paths";
import { optedOut } from "@/lib/visit-beacon";

import type { Verdict } from "@/lib/click-signals";

import { flushClicks, startClickWatch, stopClickWatch } from "./click-watch";
import { forgetRecordings, hasRecordingIds } from "./forget";
import { addVerdicts, discardView, endView, openViewPath, startView, summarise, viewAge, visibilityChanged } from "./heat-collector";

/** A kept view (the cart drawer was open) is continued on its own page within this time; after it, a new view starts. */
const KEEP_VIEW_MS = 30 * 60_000;

export type SignalStore = { id: string; slug: string; heatmaps: boolean; recordings: boolean; share: number; mask: string };

const swallow = (run: () => void) => {
  try {
    run();
  } catch {
    // Measuring is never worth an error in a visitor's browser.
  }
};

/** Whether this visitor allowed heatmaps on this store now: statistics, against a banner that named heatmaps. */
function heatAllowed(store: SignalStore): boolean {
  if (!store.heatmaps) return false;
  const name = consentCookieName(store.id);
  const pair = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  const stored = decodeConsent(pair?.slice(name.length + 1));
  return stored !== null && stored.choices.statistics && versionHas(stored.version, "heat");
}

/** Whether this visitor allowed recordings of visits on this store now. */
function recAllowed(store: SignalStore): boolean {
  if (!store.recordings) return false;
  const name = consentCookieName(store.id);
  const pair = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return decodeConsent(pair?.slice(name.length + 1))?.choices.recordings === true;
}

/** The recorder, loaded on first need so rrweb is never in a page's first scripts, and kept for the page's life. */
type Recorder = typeof import("./session-recorder");
let recorder: Recorder | null = null;
let loading: Promise<Recorder> | null = null;
const loadRecorder = () => (loading ??= import("./session-recorder").then((m) => (recorder = m)));

/** Verdicts go to the heat view and, while it records, to the recorder's counts. */
function onVerdicts(verdicts: Verdict[]) {
  addVerdicts(verdicts);
  recorder?.noteClicks(verdicts);
}

function quiet(store: SignalStore): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  if (
    optedOut({
      globalPrivacyControl: nav.globalPrivacyControl,
      doNotTrack: nav.doNotTrack,
      windowDoNotTrack: (window as Window & { doNotTrack?: string }).doNotTrack,
      msDoNotTrack: nav.msDoNotTrack,
    })
  )
    return true;
  // Staff looking at their own store are not visitors.
  return (adminReturnPath(store.slug, document.cookie) ?? handedOffPath(store.slug)) !== null;
}

/** Summarises the open view with every click still waiting, as not dead. */
function send() {
  addVerdicts(flushClicks());
  summarise();
}

/** Ends the open view, if any, with its last summary. */
function end() {
  addVerdicts(flushClicks());
  endView();
}

/**
 * Heatmaps' eyes on a store's pages (D656, `docs/heatmaps-and-recordings.md` 7.2): for a visitor who allowed them, on a page that is
 * measured, it keeps a view of the page (reach, attention, clicks) and sends it as a summary when the tab is hidden, the page changes or
 * the visitor leaves. For a visitor who allowed recordings, on a page they may see, it loads the recorder (step 9) and pauses it on any other
 * page, when the cart drawer opens and when the visitor leaves. Draws nothing. `MarketExtras` mounts it only for a store with heatmaps or
 * recordings on, so it is never on a pay route.
 */
export function SiteSignals({ store: given, breakpoints: givenBreakpoints }: { store: SignalStore; breakpoints: Breakpoints }) {
  const pathname = usePathname();
  // By value, so a fresh copy of the same props from the server does not end or restart anything.
  const { id, slug, heatmaps, recordings, share, mask } = given;
  const store = useMemo(() => ({ id, slug, heatmaps, recordings, share, mask }), [id, slug, heatmaps, recordings, share, mask]);
  const { md, lg, xl } = givenBreakpoints;
  const breakpoints = useMemo(() => ({ md, lg, xl }), [md, lg, xl]);

  // The page changed (or the component came back after the cart drawer): end a view of another page, start or continue this one's.
  useLayoutEffect(() => {
    swallow(() => {
      if (quiet(store)) return;
      const path = window.location.pathname;
      const place = signalPlace(path, window.location.search, store.slug);
      const heat = heatAllowed(store) && Boolean(place?.heat);
      const rec = recAllowed(store) && Boolean(place?.rec);
      if (heatAllowed(store)) {
        const kept = openViewPath();
        if (kept !== null && (kept !== path || viewAge() > KEEP_VIEW_MS)) end();
        if (heat && openViewPath() === null) startView(store.slug, deviceClass(window.innerWidth, breakpoints));
      }
      if (heat || rec) startClickWatch(onVerdicts);
      else stopClickWatch();
      // Recordings (D656 step 9): the recorder records an allowed page and pauses on any other; it guards itself as well.
      const device = deviceClass(window.innerWidth, breakpoints);
      if (rec) {
        void loadRecorder()
          .then((r) => r.recordPage({ id: store.id, slug: store.slug, share: store.share, mask: store.mask === "strict" ? "strict" : "balanced", device }, path))
          .catch(() => {});
      } else recorder?.pause(false);
    });
    // No cleanup: an unmount must keep the view, which only the effect below can tell.
  }, [pathname, store, breakpoints]);

  useEffect(() => {
    const onVisibility = () =>
      swallow(() => {
        visibilityChanged();
        if (document.visibilityState === "hidden") {
          send();
          recorder?.hidden();
        }
      });
    const onPageHide = () =>
      swallow(() => {
        end();
        recorder?.pause(true);
      });
    const onPageShow = (event: PageTransitionEvent) =>
      swallow(() => {
        // Back from the browser's cache: the page is seen again, as a new view.
        if (!event.persisted || quiet(store) || !heatAllowed(store)) return;
        if (!signalPlace(window.location.pathname, window.location.search, store.slug)?.heat) return;
        startClickWatch(addVerdicts);
        startView(store.slug, deviceClass(window.innerWidth, breakpoints));
      });
    const stopListening = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
    // A choice was made: the banner reloads the page in the same task, so all of this is synchronous.
    const onConsent = () =>
      swallow(() => {
        const heat = heatAllowed(store);
        const rec = recAllowed(store);
        if (!rec && store.recordings) {
          // Withdrawn: nothing buffered is sent, and the browser's recordings are deleted at once.
          recorder?.discard();
          forgetRecordings(store);
        }
        if (heat) return;
        discardView();
        if (!rec) {
          stopClickWatch();
          stopListening();
        }
      });
    // Ids left from recordings this browser no longer allows (withdrawn while this page was not listening) are deleted.
    swallow(() => {
      if (store.recordings && !recAllowed(store) && hasRecordingIds(store.id)) forgetRecordings(store);
    });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener(CONSENT_CHANGED_EVENT, onConsent);
    return () => {
      // Unmounted (the cart drawer opened, or the visitor left the store's pages): a continuation, and the view is kept.
      swallow(send);
      swallow(() => recorder?.pause(true));
      stopListening();
      window.removeEventListener(CONSENT_CHANGED_EVENT, onConsent);
    };
  }, [store, breakpoints]);

  return null;
}
