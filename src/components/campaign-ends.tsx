"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

/**
 * Stops announcing a campaign the moment it ends (D115). The page is cached,
 * and the announcement with it, so the browser checks the time: it is asked
 * at hydration and again when the campaign ends. Without script the
 * announcement stays until the cache next refreshes.
 */
export function CampaignEnds({ endsAt, children }: { endsAt: string | null; children: ReactNode }) {
  const end = endsAt ? new Date(endsAt).getTime() : null;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (end === null) return () => {};
      const left = end - Date.now();
      // A timer holds at most about 24 days; a longer campaign is checked again by the next visit.
      if (left <= 0 || left > 2_000_000_000) return () => {};
      const timer = setTimeout(onChange, left);
      return () => clearTimeout(timer);
    },
    [end],
  );
  const over = useSyncExternalStore(
    subscribe,
    () => end !== null && Date.now() >= end,
    () => false,
  );
  return over ? null : <>{children}</>;
}
