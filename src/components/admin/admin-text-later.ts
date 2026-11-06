"use client";

import type { AdminAreaMessages, ClientArea } from "@/lib/admin-text";

/**
 * Areas the layouts always hand down (the signed-in layout `setup` and `shell`, the sandbox's `shell`), so their English is not in every
 * screen's first scripts (`e2e/signed-in/admin-scripts.spec.ts`): a part that reads one where no layout handed it down fetches the English
 * then, a chunk of its own, and waits for it (`use()`). `common` and `signIn` are read outside the admin too (`useCommonText()`), so they stay.
 */
export type LaterArea = "setup" | "shell";
const LATER: { [A in LaterArea]: () => Promise<AdminAreaMessages[A]> } = {
  setup: () => import("@/lib/admin-messages/setup.en").then((m) => m.setupEn),
  shell: () => import("@/lib/admin-messages/shell.en").then((m) => m.shellEn),
};
export const isLater = (area: ClientArea): area is LaterArea => area in LATER;

/** A fetch React can read with `use()`; one that is already settled (`settledEnglish()`) is read at once. */
type Thenable<T> = Promise<T> & { status?: "pending" | "fulfilled" | "rejected"; value?: T };
const fetched = new Map<LaterArea, Thenable<unknown>>();

export function englishLater<A extends LaterArea>(area: A): Promise<AdminAreaMessages[A]> {
  let found = fetched.get(area);
  if (!found) {
    found = LATER[area]();
    fetched.set(area, found);
  }
  return found as Promise<AdminAreaMessages[A]>;
}

/** An area's English as already fetched, so a part drawn on its own (a unit test's `renderToStaticMarkup()`) reads it at once. */
export function settledEnglish<A extends LaterArea>(area: A, words: AdminAreaMessages[A]): void {
  fetched.set(area, Object.assign(Promise.resolve(words), { status: "fulfilled" as const, value: words }));
}

