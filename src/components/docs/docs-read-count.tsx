"use client";

import { useEffect } from "react";

import { DOCS_READ_ENDPOINT } from "@/lib/docs-search";
import { optedOut } from "@/lib/visit-beacon";

/**
 * Counts that a docs page was read (D443), for the docs' *Most read* order: once when the page opens, with `navigator.sendBeacon` (a
 * plain-text body, so no pre-flight), the page's path and language and nothing else; nothing at all when the browser says Global Privacy
 * Control or Do Not Track. No cookie, no storage; the server counts a reader's same page once an hour. It draws nothing.
 */
export function DocsReadCount({ path, lang }: { path: string; lang: string }) {
  useEffect(() => {
    try {
      const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
      const signals = {
        globalPrivacyControl: nav.globalPrivacyControl,
        doNotTrack: nav.doNotTrack,
        windowDoNotTrack: (window as Window & { doNotTrack?: string }).doNotTrack,
        msDoNotTrack: nav.msDoNotTrack,
      };
      if (optedOut(signals) || typeof nav.sendBeacon !== "function") return;
      nav.sendBeacon(DOCS_READ_ENDPOINT, new Blob([JSON.stringify({ path, lang })], { type: "text/plain" }));
    } catch {
      // Counting is never worth an error on a page.
    }
  }, [path, lang]);
  return null;
}
