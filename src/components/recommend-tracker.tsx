"use client";

import { useEffect } from "react";

import { recordSearch, recordView } from "@/lib/recommend-session";

/**
 * Remembers in the tab (D139), for recommendations, that this product page was opened or this search was made. Session
 * storage only: gone when the tab closes, sent to the site only to ask for recommendations. Draws nothing.
 */
export function RecommendTracker({ productId, query }: { productId?: string; query?: string }) {
  useEffect(() => {
    try {
      if (productId) recordView(window.sessionStorage, productId);
      if (query) recordSearch(window.sessionStorage, query);
    } catch {
      // No session storage: recommendations go without the session.
    }
  }, [productId, query]);
  return null;
}
