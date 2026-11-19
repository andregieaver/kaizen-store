"use client";

import { useSyncExternalStore } from "react";

/** The country suggestion (D338) as `/api/shop/mine` answers it, ready for `CountryHint`. */
export type Hint = {
  fromBase: string;
  toBase: string;
  lang: string;
  words: { offer: string; go: string; close: string; label: string };
};

/**
 * What is this visitor's own on a store page (bloat review step 2.4): the cart's count, the saved products (D34) and the country
 * suggestion, asked from `/api/shop/mine` at most once per document for a store and market, and only when the marker cookie
 * `kaizen_mine_{storeId}` (`mineCookieName()` on the server) says there may be something, or the store sells in several countries
 * (`hinted`). The pages themselves stay the same for everyone, and static. Each value is null until it is known.
 */
let cart: number | null = null;
let saved: Set<string> | null = null;
/** The store and market the values are for: a client navigation to another market starts them again. */
let current = "";
/** Bumped by `setSaved()`, so an answer asked for before a save never overwrites what came after. */
let savedEdits = 0;
const listeners = new Set<() => void>();
/** The store and market pairs whose answer was asked for; only a request blocks a later call (the cart link may run before the hint). */
const started = new Set<string>();

function changed() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSaved(products: string[]) {
  savedEdits += 1;
  saved = new Set(products);
  changed();
}

const marked = (storeId: string) => document.cookie.split(/;\s*/).includes(`kaizen_mine_${storeId}=1`);

export function loadOwn({ store, market, storeId, hinted }: { store: string; market: string; storeId: string; hinted: boolean }) {
  const key = `${store}/${market}`;
  if (key !== current) {
    current = key;
    cart = null;
    saved = null;
    started.clear();
    changed();
  }
  if (started.has(key)) return;
  if (!marked(storeId) && !hinted) {
    // Nothing of this visitor's here, and no country to suggest: nothing to ask for.
    if (cart === null && saved === null) {
      cart = 0;
      saved = new Set();
      changed();
    }
    return;
  }
  started.add(key);
  const asked = savedEdits;
  fetch(`/api/shop/mine?store=${encodeURIComponent(store)}&market=${encodeURIComponent(market)}`, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((data: { cart: number; saved: string[]; hint: Hint | null }) => {
      if (key !== current) return;
      cart = data.cart;
      if (asked === savedEdits) saved = new Set(data.saved);
      changed();
    })
    .catch(() => {
      started.delete(key);
    });
}

export const useSaved = (): Set<string> | null => useSyncExternalStore(subscribe, () => saved, () => null);
