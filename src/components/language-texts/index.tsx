"use client";

import dynamic from "next/dynamic";
import type { ComponentType, ReactNode } from "react";

import { textsFor, type HandWritten } from "@/lib/browser-text";

/**
 * The page's interface text for its client components (D212, `docs/performance.md`). Each hand-written language is a script of its
 * own, and only the page's is loaded: the server draws it and asks for its script with the page's (as `lazyView()`'s parts), and
 * as nothing here waits in a `<Suspense>`, the page under it wakes up only once its language is registered, so `browserText()`
 * always finds it. Every root layout that can draw a visitor's client component draws its body inside this. The `import()` must be
 * written inside `dynamic()`, as Next finds the scripts to preload by it.
 */
const LANGUAGES: Record<HandWritten, ComponentType<{ lang: string; children: ReactNode }>> = {
  nb: dynamic(() => import("./nb")),
  sv: dynamic(() => import("./sv")),
  da: dynamic(() => import("./da")),
  en: dynamic(() => import("./en")),
};

export function LanguageTexts({ lang, children }: { lang: string; children: ReactNode }) {
  const Texts = LANGUAGES[textsFor(lang)];
  return <Texts lang={lang}>{children}</Texts>;
}
