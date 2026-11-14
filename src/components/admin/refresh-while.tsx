"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { progressTick } from "@/lib/progress-poll";

/**
 * Refreshes the page's data every few seconds while it is shown, e.g. while a scan runs. A hidden tab asks nothing and looks again once when
 * it is shown (bloat review step 0.17). With a `status` (a server action that answers a short fingerprint of what the page waits for) the
 * page is redrawn only when the fingerprint changed; without one it is redrawn on every tick. `drawn` is the fingerprint the server drew the
 * page from: the poll compares with it, so a change that lands before the first tick or between a redraw and the next tick is not missed.
 */
export function RefreshWhile({ seconds, status, drawn }: { seconds: number; status?: () => Promise<string | null>; drawn?: string }) {
  const router = useRouter();
  // What the page shows, kept across redraws (a bound action is a new function on each render, which restarts the effect).
  const last = useRef<{ value: string | null }>({ value: drawn ?? null });
  useEffect(() => {
    if (drawn !== undefined) last.current.value = drawn;
  }, [drawn]);
  useEffect(() => {
    const timer = window.setInterval(
      () => void progressTick({ visible: document.visibilityState === "visible", status, last: last.current, refresh: () => router.refresh() }),
      seconds * 1000,
    );
    const back = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [router, seconds, status]);
  return null;
}
