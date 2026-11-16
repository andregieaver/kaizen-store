"use client";

import { useEffect } from "react";

import { consentCookieName, decodeConsent } from "@/lib/cookie-consent";

/**
 * Tells the store that this product page was seen (D691, browse abandonment), only when the visitor allowed marketing cookies on this store.
 * The server keeps it only for a signed-in customer subscribed to the store's emails while its browse email is on; nothing is stored in the
 * browser, and no answer says which. Draws nothing.
 */
export function BrowseTracker({ storeId, store, market, productId }: { storeId: string; store: string; market: string; productId: string }) {
  useEffect(() => {
    try {
      const name = consentCookieName(storeId);
      const pair = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
      if (decodeConsent(pair?.slice(name.length + 1))?.choices.marketing !== true) return;
      void fetch("/api/shop/viewed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, market, product: productId }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // Never worth an error in a visitor's browser.
    }
  }, [storeId, store, market, productId]);
  return null;
}
