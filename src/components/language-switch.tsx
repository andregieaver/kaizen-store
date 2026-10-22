"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { mayRemember } from "@/lib/page-modal";
import { englishPath, PLATFORM_LANG_FACTS, platformPath, suggestedLang, type PlatformLang } from "@/lib/platform-lang";
import { LANGUAGE_HINT_KEY, LANGUAGE_HINT_TEXT } from "@/lib/platform-lang-text";

/** This page's address in another language of the site, its query kept (D312). */
function sameIn(lang: PlatformLang, pathname: string, query: string): string {
  return platformPath(lang, englishPath(pathname)) + (query ? `?${query}` : "");
}

/**
 * The site's languages, each a link to this page in it (D312), placed under the footer. A full page load, as each language is a
 * root layout of its own. Drawn in a `<Suspense>`: it reads the address.
 */
export function LanguageSwitch({ lang, offered }: { lang: PlatformLang; offered: readonly PlatformLang[] }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  if (offered.length < 2) return null;
  return (
    <nav aria-label={LANGUAGE_HINT_TEXT[lang].switchLabel} className="mx-auto flex w-full max-w-5xl flex-wrap gap-4 px-4 pb-6 text-sm text-muted">
      {offered.map((other) =>
        other === lang ? (
          <span key={other} aria-current="true" lang={PLATFORM_LANG_FACTS[other].tag} className="font-medium text-foreground">
            {PLATFORM_LANG_FACTS[other].name}
          </span>
        ) : (
          <a key={other} href={sameIn(other, pathname, query)} hrefLang={PLATFORM_LANG_FACTS[other].tag} lang={PLATFORM_LANG_FACTS[other].tag} className="underline">
            {PLATFORM_LANG_FACTS[other].name}
          </a>
        ),
      )}
    </nav>
  );
}

/**
 * A bar suggesting this page in the browser's own language, once (D312: the site suggests, never redirects). Closing it is remembered only
 * for a visitor who allowed preferences (`kaizen_lang_hint` in local storage); otherwise it stays closed for this page view.
 */
export function LanguageHint({ lang, offered }: { lang: PlatformLang; offered: readonly PlatformLang[] }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const [target, setTarget] = useState<PlatformLang | null>(null);

  useEffect(() => {
    let closed = false;
    try {
      closed = window.localStorage.getItem(LANGUAGE_HINT_KEY) !== null;
    } catch {
      // Storage refused: the bar is shown, and closing it lasts for the page view.
    }
    const next = closed ? null : suggestedLang(navigator.languages ?? [navigator.language], lang, offered);
    // Read once in the browser: the server draws the page the same for every visitor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(next);
  }, [lang, offered]);

  if (!target) return null;
  const text = LANGUAGE_HINT_TEXT[target];
  const close = () => {
    setTarget(null);
    if (!mayRemember(document.cookie, null)) return;
    try {
      window.localStorage.setItem(LANGUAGE_HINT_KEY, "1");
    } catch {
      // Not kept; it is closed for this page view.
    }
  };
  return (
    <div role="region" aria-label={text.switchLabel} lang={PLATFORM_LANG_FACTS[target].tag} className="border-b border-border bg-surface text-sm">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-2">
        <span>{text.offer}</span>
        <a href={sameIn(target, pathname, query)} hrefLang={PLATFORM_LANG_FACTS[target].tag} className="font-medium underline">
          {text.go}
        </a>
        <button type="button" onClick={close} className="ml-auto min-h-10 rounded-full px-3 hover:bg-background">
          {text.close}
        </button>
      </div>
    </div>
  );
}
