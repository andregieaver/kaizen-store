"use client";

import { useEffect } from "react";

import { CONSENT_CHANGED_EVENT, consentCookieName, decodeConsent } from "@/lib/cookie-consent";
import { dataCookieName, decodeAssignments, MARKER_COOKIE } from "@/lib/experiments";

const read = (name: string): string | undefined => {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
};

const forget = (name: string) => {
  document.cookie = `${name}=; Max-Age=0; Path=/`;
};

/**
 * Asks for a visitor's versions of the store's running A/B tests (D148) once they have accepted statistics cookies, and
 * again after a choice or when a test they have no answer for has started. Draws nothing. When statistics are not (or
 * no longer) accepted it removes what it set. A store's A/B cookies are `kaizen_ab_{id}` and the marker `kaizen_ab`.
 */
export function AbAssign({ storeId, store, market, running }: { storeId: string; store: string; market: string; running: string[] }) {
  useEffect(() => {
    const ask = () => {
      const accepted = decodeConsent(read(consentCookieName(storeId)))?.choices.statistics === true;
      if (!accepted) {
        if (read(dataCookieName(storeId)) !== undefined) {
          forget(dataCookieName(storeId));
          forget(MARKER_COOKIE);
        }
        return;
      }
      const mine = decodeAssignments(read(dataCookieName(storeId)));
      if (running.length === 0 || running.every((id) => mine?.versions[id] !== undefined)) return;
      void fetch("/api/ab/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store, market }), keepalive: true }).catch(() => undefined);
    };
    ask();
    window.addEventListener(CONSENT_CHANGED_EVENT, ask);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, ask);
  }, [storeId, store, market, running]);
  return null;
}
