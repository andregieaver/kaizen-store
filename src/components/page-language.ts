"use client";

import { useSyncExternalStore } from "react";

/** The page's language, read in the browser (the server draws blocks before it is known there, and the builder's canvas shares them). */
export function usePageLanguage(): string {
  return useSyncExternalStore(
    () => () => {},
    () => document.documentElement.lang.split("-")[0] || "en",
    () => "en",
  );
}
