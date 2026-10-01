"use client";

import { useSyncExternalStore } from "react";

import { attributionFor } from "@/lib/recommend-session";

const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
};

const snapshot = (): string | null => {
  try {
    return attributionFor(window.sessionStorage);
  } catch {
    return null;
  }
};

/**
 * What the tab remembers of the products opened from recommendations (D139), as a hidden field of a form that adds to the
 * cart, so the server can credit the add to the recommendation. Nothing when there is none, so the form is unchanged; the
 * server checks it and keeps only the cart, product, ranking and placement.
 */
export function RecommendField() {
  const value = useSyncExternalStore(subscribe, snapshot, () => null);
  return value ? <input type="hidden" name="rec" value={value} /> : null;
}
