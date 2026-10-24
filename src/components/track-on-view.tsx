"use client";

import { useEffect, useRef } from "react";

import { trackShop, type ShopEvent } from "@/lib/shop-events";

/** Tells the store's tags of a list or a search shown (D303 I1), once per page; draws nothing. */
export function TrackOnView({ event }: { event: ShopEvent }) {
  const sent = useRef<string | null>(null);
  const key = JSON.stringify(event);
  useEffect(() => {
    if (sent.current === key) return;
    sent.current = key;
    trackShop(JSON.parse(key) as ShopEvent);
  }, [key]);
  return null;
}
