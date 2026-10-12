"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

/** The language the root layout drew the page in (`LanguageTexts`, D212); English where none is given. */
export const PageLanguageContext = createContext("en");

/**
 * The page's language, read in the browser from the document (the server draws blocks before it is known there, and the builder's
 * canvas shares them). While the page wakes up it is the language the layout gave, which is the document's, so nothing changes then.
 */
export function usePageLanguage(): string {
  const given = useContext(PageLanguageContext);
  return useSyncExternalStore(
    () => () => {},
    () => document.documentElement.lang.split("-")[0] || given,
    () => given,
  );
}
