"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the page every few seconds while waiting for something the
 * server will learn about (e.g. a payment confirmation), for about a minute.
 */
export function RefreshWhile({ waiting, seconds = 3 }: { waiting: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!waiting) return;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      if (count > 20) clearInterval(timer);
      else router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [waiting, seconds, router]);
  return null;
}
