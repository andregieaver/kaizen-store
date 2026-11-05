"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { mayRemember } from "@/lib/page-modal";
import { englishPath, PLATFORM_LANG_FACTS, platformPath, suggestedLang, type PlatformLang } from "@/lib/platform-lang";
import { LANGUAGE_HINT_KEY, LANGUAGE_HINT_TEXT } from "@/lib/platform-lang-text";

import { HINT_CARD } from "./hint-card";

/** This page's address in another language of the site, its query kept (D312). */
function sameIn(lang: PlatformLang, pathname: string, query: string): string {
  return platformPath(lang, englishPath(pathname)) + (query ? `?${query}` : "");
}

/**
 * The site's languages, each a link to this page in it (D312): the *Languages* part of Kaizena Flow's header or footer, where the
 * owner places it (nothing is added under the footer by itself), and the foot of the phone's slide-out menu (`menu`), as a store's
 * menu ends with its languages and countries. A full page load, as each language is a root layout of its own. Each is a target of
 * 24 px at least (WCAG 2.5.8, `e2e/target-size.spec.ts`), in a footer as anywhere; in the menu, 44 px as its other links.
 * Drawn in a `<Suspense>`: it reads the address.
 */
export function LanguageSwitch({ lang, offered, menu = false }: { lang: PlatformLang; offered: readonly PlatformLang[]; menu?: boolean }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  if (offered.length < 2) return null;
  const label = LANGUAGE_HINT_TEXT[lang].switchLabel;
  if (menu) {
    // As the store's menu shows its countries: a heading, then one button-like link per language, the current one marked.
    const pill = "flex min-h-11 items-center rounded-button border px-4 text-sm";
    return (
      <nav aria-label={label} className="mt-auto">
        <p className="mb-2 text-sm text-muted">{label}</p>
        <ul className="flex flex-wrap gap-2">
          {offered.map((other) => (
            <li key={other}>
              {other === lang ? (
                <span aria-current="true" lang={PLATFORM_LANG_FACTS[other].tag} className={`${pill} border-foreground font-semibold`}>
                  {PLATFORM_LANG_FACTS[other].name}
                </span>
              ) : (
                <a href={sameIn(other, pathname, query)} hrefLang={PLATFORM_LANG_FACTS[other].tag} lang={PLATFORM_LANG_FACTS[other].tag} className={`${pill} border-border`}>
                  {PLATFORM_LANG_FACTS[other].name}
                </a>
              )}
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {offered.map((other) =>
        other === lang ? (
          <span key={other} aria-current="true" lang={PLATFORM_LANG_FACTS[other].tag} className="inline-flex min-h-6 items-center font-medium text-foreground">
            {PLATFORM_LANG_FACTS[other].name}
          </span>
        ) : (
          <a key={other} href={sameIn(other, pathname, query)} hrefLang={PLATFORM_LANG_FACTS[other].tag} lang={PLATFORM_LANG_FACTS[other].tag} className="inline-flex min-h-6 min-w-6 items-center underline">
            {PLATFORM_LANG_FACTS[other].name}
          </a>
        ),
      )}
    </nav>
  );
}

/**
 * A card suggesting this page in the browser's own language, once (D312: the site suggests, never redirects). Closing it is remembered only
 * for a visitor who allowed preferences (`kaizen_lang_hint` in local storage); otherwise it stays closed for this page view. It floats
 * above the foot of the screen (the phone's bottom bar), as a store's country suggestion does: at the top of the page a header that lies
 * over the page (D80), fixed there, covered it.
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
    <div
      role="region"
      aria-label={text.switchLabel}
      lang={PLATFORM_LANG_FACTS[target].tag}
      data-language-hint=""
      className={HINT_CARD}
    >
      <span className="min-w-0 flex-1">{text.offer}</span>
      <a href={sameIn(target, pathname, query)} hrefLang={PLATFORM_LANG_FACTS[target].tag} className="font-medium underline">
        {text.go}
      </a>
      <button type="button" onClick={close} className="min-h-10 rounded-full px-3 hover:bg-background">
        {text.close}
      </button>
    </div>
  );
}
