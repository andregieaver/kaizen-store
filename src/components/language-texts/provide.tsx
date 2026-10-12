"use client";

import type { ReactNode } from "react";

import { PageLanguageContext } from "../page-language";

/** What each language's module draws once its text is registered: the page, knowing its language (`usePageLanguage()`). */
export function ProvideLanguage({ lang, children }: { lang: string; children: ReactNode }) {
  return <PageLanguageContext value={lang}>{children}</PageLanguageContext>;
}
