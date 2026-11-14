"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { progressTick } from "@/lib/progress-poll";

/**
 * Refreshes the page's data every few seconds while it is shown, e.g. while a scan runs. A hidden tab asks nothing and looks again once when
 * it is shown (bloat review step 0.17). With a `status` (a server action that answers a short fingerprint of what the page waits for) the
 * page is redrawn only when the fingerprint changed; without one it is redrawn on every tick.
 */
export function RefreshWhile({ seconds, status }: { seconds: number; status?: () => Promise<string | null> }) {
  const router = useRouter();
  useEffect(() => {
    const last = { value: null as string | null };
    const timer = window.setInterval(
      () => void progressTick({ visible: document.visibilityState === "visible", status, last, refresh: () => router.refresh() }),
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
