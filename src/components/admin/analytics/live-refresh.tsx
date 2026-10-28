"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Reads the Live page again every `every` milliseconds while the tab is shown (wave 8 unit C, D347; decision 2: polling, never a socket),
 * and once when the tab comes back into view. Draws nothing: the server draws the figures.
 */
export function LiveRefresh({ every }: { every: number }) {
  const router = useRouter();
  useEffect(() => {
    const shown = () => document.visibilityState === "visible";
    const timer = window.setInterval(() => {
      if (shown()) router.refresh();
    }, every);
    const back = () => {
      if (shown()) router.refresh();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [router, every]);
  return null;
}
