"use client";

import { useEffect, useState } from "react";

import type { Messages } from "@/lib/i18n";

/**
 * One storefront language, fetched when a preview in the admin needs it (bloat review step 2.29, `docs/rules/storefront.md` under
 * 'Interface text lives in src/lib/i18n.ts'). The admin's browser never imports `lib/i18n` or a language's module: until 19 November 2026
 * 40 admin routes carried all four languages (about 318 KB) for the page builder's grid, modal and email-form previews. Here each
 * hand-written language is a chunk of its own, fetched once per language and waited for with `useSiteWords()`, which gives null until it
 * arrives. A language translated by AI has no module and previews in English, as the browser did before.
 */
type SiteLanguage = "en" | "nb" | "sv" | "da";

const LOAD: Record<SiteLanguage, () => Promise<Messages>> = {
  en: () => import("@/lib/messages/en").then((m) => m.en),
  nb: () => import("@/lib/messages/nb").then((m) => m.nb),
  sv: () => import("@/lib/messages/sv").then((m) => m.sv),
  da: () => import("@/lib/messages/da").then((m) => m.da),
};

const languageOf = (lang: string): SiteLanguage => (lang === "nb" || lang === "sv" || lang === "da" ? lang : "en");

const fetched = new Map<SiteLanguage, Promise<Messages>>();
const arrived = new Map<SiteLanguage, Messages>();

/** A language's words, fetched once; a failed fetch is forgotten so the next call tries again. */
export function siteWordsLater(lang: string): Promise<Messages> {
  const key = languageOf(lang);
  let found = fetched.get(key);
  if (!found) {
    found = LOAD[key]().then(
      (words) => {
        arrived.set(key, words);
        return words;
      },
      (error: unknown) => {
        fetched.delete(key);
        throw error;
      },
    );
    fetched.set(key, found);
  }
  return found;
}

/** The words of a language, null until they arrive (at once when an earlier preview fetched them). */
export function useSiteWords(lang: string): Messages | null {
  const key = languageOf(lang);
  const [late, setLate] = useState<{ key: SiteLanguage; words: Messages } | null>(null);
  useEffect(() => {
    let current = true;
    siteWordsLater(key).then(
      (words) => {
        if (current) setLate({ key, words });
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [key]);
  return arrived.get(key) ?? (late?.key === key ? late.words : null);
}

/** A language's words as already fetched, so a part drawn on its own (a unit test's `renderToStaticMarkup()`) reads them at once. */
export function settleSiteWords(lang: string, words: Messages): void {
  const key = languageOf(lang);
  arrived.set(key, words);
  fetched.set(key, Promise.resolve(words));
}
