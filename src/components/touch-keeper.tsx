"use client";

import { useEffect } from "react";

import { CONSENT_CHANGED_EVENT, consentCookieName, decodeConsent } from "@/lib/cookie-consent";
import { TOUCH_DAYS, decodeTouch, encodeTouch, keepTouch, touchCookieName, touchOf } from "@/lib/first-touch";

/**
 * Keeps the visitor's first visit in 30 days (D303 I3) in a first-party cookie, only while they allow statistics cookies, and tells the
 * server once per page load so today's visit knows it. Draws nothing. Without consent it sets nothing and sends nothing.
 */
export function TouchKeeper({ store, storeId }: { store: string; storeId: string }) {
  useEffect(() => {
    const run = () => {
      try {
        const jar = document.cookie.split("; ");
        const read = (name: string) => jar.find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
        if (!decodeConsent(read(consentCookieName(storeId)))?.choices.statistics) return;
        const today = new Date().toISOString().slice(0, 10);
        const touch = keepTouch(decodeTouch(read(touchCookieName(storeId))), touchOf(location.search, document.referrer, location.host, today), today);
        if (!touch) return;
        const secure = location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `${touchCookieName(storeId)}=${encodeTouch(touch)}; Max-Age=${TOUCH_DAYS * 86400}; Path=/; SameSite=Lax${secure}`;
        // After the page view is counted, so today's visit exists.
        window.setTimeout(() => {
          navigator.sendBeacon?.("/api/visit/touch", new Blob([JSON.stringify({ store, ...touch })], { type: "text/plain" }));
        }, 1500);
      } catch {
        // Attribution is never worth an error on a page.
      }
    };
    run();
    window.addEventListener(CONSENT_CHANGED_EVENT, run);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, run);
  }, [store, storeId]);
  return null;
}
