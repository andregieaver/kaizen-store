"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the page's data every few seconds while it is shown, e.g. while a scan runs. */
export function RefreshWhile({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return null;
}
