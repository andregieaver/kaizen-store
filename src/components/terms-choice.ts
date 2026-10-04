"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the shopper has ticked the terms box at checkout (wave 1, 1e, `docs/wave-1-trust.md` 2.4). The box and the pay
 * button can sit in different places on a page the owner built, so the choice is a tiny store shared by the two, kept in
 * memory for the page and never in a cookie or in browser storage: nothing is added to `KNOWN_COOKIES`, and a reload starts
 * with the box unticked.
 */
const ticks = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** One checkout of one store in one market. */
export const termsKey = (store: string, market: string) => `${store}/${market}`;

export function setTicked(key: string, ticked: boolean): void {
  if ((ticks.get(key) ?? false) === ticked) return;
  ticks.set(key, ticked);
  for (const listener of listeners) listener();
}

export const isTicked = (key: string): boolean => ticks.get(key) ?? false;

/** Forgets every choice (tests). */
export function resetTicks(): void {
  ticks.clear();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the box is ticked; false while the page is drawn on the server. */
export function useTicked(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isTicked(key),
    () => false,
  );
}
