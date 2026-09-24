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

/**
 * Re-renders the page once, the first time it is shown with this key: for
 * parts rendered alongside the change that made them stale (the header's
 * cart count, rendered while the order page confirms the payment).
 */
export function RefreshOnce({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => {
    const key = `kaizen-refreshed:${id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      return; // Without storage, a stale count is better than a refresh loop.
    }
    router.refresh();
  }, [id, router]);
  return null;
}
