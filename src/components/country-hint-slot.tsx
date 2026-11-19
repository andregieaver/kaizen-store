"use client";

import { useEffect } from "react";

import { CountryHint } from "./lazy/country-hint";
import { loadOwn, useHint } from "./shopper-own";

/**
 * The country suggestion (D338) in a store with several countries: asked by the browser from `/api/shop/mine` (one small call a page
 * load, shared with the cart's count), which answers nothing for a crawler or a visitor already in their country.
 */
export function CountryHintSlot({ store, market, storeId }: { store: string; market: string; storeId: string }) {
  useEffect(() => loadOwn({ store, market, storeId, hinted: true }), [store, market, storeId]);
  const hint = useHint();
  return hint ? <CountryHint fromBase={hint.fromBase} toBase={hint.toBase} lang={hint.lang} words={hint.words} /> : null;
}
