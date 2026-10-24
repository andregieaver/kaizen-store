"use client";

import { createContext, useContext } from "react";

/** What a product page tells the store's tags about its variants (D303 I1): ids, prices as shown in major units, nothing personal. */
export type ShopTrack = { name: string; currency: string; variants: Record<string, { id: string; price: number; variant?: string }> };

export const TrackContext = createContext<ShopTrack | null>(null);

/** The page's variants as the tags hear of them, or null outside a product page. */
export const useShopTrack = () => useContext(TrackContext);

/** One variant as an event item, or null when the page did not say. */
export function trackedItem(track: ShopTrack | null, variantId: string, quantity: number) {
  const known = track?.variants[variantId];
  return track && known ? { currency: track.currency, items: [{ ...known, name: track.name, quantity }] } : null;
}
