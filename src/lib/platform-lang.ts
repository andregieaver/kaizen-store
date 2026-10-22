/**
 * The languages Kaizena Flow's own site is drawn in (D312, docs/platform-admin-i18n.md 3.1): English at the addresses it always had, and
 * every other language under its own prefix (Norwegian `/no`, `/no/themes`, `/no/sign-up`: the country's code people know, while the
 * language itself is tagged `nb`, Bokmål, for `<html lang>` and `hreflang`), so no English link breaks. A language is never chosen
 * for a visitor by a redirect; the site only suggests one (`suggestedLang()`).
 *
 * Pure: the routes, the sitemap, the metadata and the language bar ask these, and build every address on the site with `platformPath()`.
 */

/** The site's languages, English first: the source and the fallback. A new one is a code here, its catalogues and its route group. */
export const PLATFORM_LANGS = ["en", "nb"] as const;
export type PlatformLang = (typeof PLATFORM_LANGS)[number];

/** The language codes a page of Kaizena Flow's may never take as its address, so a prefix stays a prefix (`pages_slug_not_reserved`). */
export const LANGUAGE_PREFIXES: readonly string[] = ["en", "nb", "nn", "no", "sv", "da"];

type LangFacts = {
  /** `<html lang>` and `hreflang`. */
  tag: string;
  /** The first part of its addresses (`/no/themes`); English has none. */
  prefix: string;
  /** The BCP 47 locale for dates, numbers and money (`Intl`). */
  locale: string;
  /** Open Graph's `og:locale`. */
  ogLocale: string;
  /** The language's own name, shown in the language switch. */
  name: string;
  /** Its name in English, for the admin (English until A0). */
  english: string;
  /** The subtag the shopper catalogues (`t()`) and the cookie texts are keyed by. */
  messages: string;
};

export const PLATFORM_LANG_FACTS: Record<PlatformLang, LangFacts> = {
  en: { tag: "en", prefix: "", locale: "en-GB", ogLocale: "en_GB", name: "English", english: "English", messages: "en" },
  nb: { tag: "nb", prefix: "no", locale: "nb-NO", ogLocale: "nb_NO", name: "Norsk", english: "Norwegian", messages: "nb" },
};

/**
 * The languages Kaizena Flow's own pages and menus are written in (D312 P4), as the page builder keys them: English (`en`, the page as it
 * is written) first, then every other language by its locale (`nb-NO`), whose texts are laid over the English (D55). Every language the
 * site has, offered or not, so its words can be written before it is turned on.
 */
export const PLATFORM_PAGE_LOCALES: readonly string[] = PLATFORM_LANGS.map((lang) => (lang === "en" ? "en" : PLATFORM_LANG_FACTS[lang].locale));

/** The locale a page's texts in `lang` are kept under (`nb-NO`), or null for English, which is the page as written. */
export function pageLocaleOf(lang: PlatformLang): string | null {
  return lang === "en" ? null : PLATFORM_LANG_FACTS[lang].locale;
}

export function isPlatformLang(value: unknown): value is PlatformLang {
  return typeof value === "string" && (PLATFORM_LANGS as readonly string[]).includes(value);
}

/** The language a locale of `platform_settings.locales` (`nb-NO`) stands for, or null when the site has no such language. */
export function langOfLocale(locale: string): PlatformLang | null {
  const sub = locale.toLowerCase().split("-")[0];
  return isPlatformLang(sub) ? sub : null;
}

/**
 * An address of the site in a language: `path` is the English one (`/`, `/themes`, `/sign-up?x=1`, `/blog#a`). English is as given; another
 * language puts its prefix before it (`/no`, `/no/themes`). Anything that is not an address of the site's own pages is left as written: another
 * site, a store's (`/s/…`), the admin (`/admin`), `/api`, `/auth`, a referral link (`/r/…`), a file, a fragment alone or `mailto:`.
 */
export function platformPath(lang: PlatformLang, path: string): string {
  if (lang === "en" || !isSitePath(path)) return path;
  const cut = path.search(/[?#]/);
  const pathname = cut === -1 ? path : path.slice(0, cut);
  const rest = cut === -1 ? "" : path.slice(cut);
  if (langOfPath(pathname)) return path;
  return `/${PLATFORM_LANG_FACTS[lang].prefix}${pathname === "/" ? "" : pathname}${rest}`;
}

/** Whether an address is one of the site's own pages, which take a language prefix. */
function isSitePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  const first = path.slice(1).split(/[/?#]/)[0];
  if (["s", "admin", "api", "auth", "r", "_next", "demo", "kaizen", "downloads"].includes(first)) return false;
  return !/\.[a-z0-9]+$/i.test(first) || first === "";
}

/** The language a pathname is in by its prefix (`/no/themes` is Norwegian), or null for English and anything else. */
export function langOfPath(pathname: string): Exclude<PlatformLang, "en"> | null {
  const first = pathname.split("/")[1] ?? "";
  if (first === "") return null;
  const lang = PLATFORM_LANGS.find((l) => l !== "en" && PLATFORM_LANG_FACTS[l].prefix === first);
  return lang && lang !== "en" ? lang : null;
}

/** The English address of a pathname in any language: `/no/themes` is `/themes`, `/no` is `/`. */
export function englishPath(pathname: string): string {
  const lang = langOfPath(pathname);
  if (!lang) return pathname;
  const rest = pathname.slice(PLATFORM_LANG_FACTS[lang].prefix.length + 1);
  return rest === "" ? "/" : rest;
}

/**
 * The page's addresses in the languages the site offers, for `<link rel="alternate" hreflang>` and the sitemap: each language's address of the
 * English `path`, and `x-default` the English one. With English alone there is nothing to say, so nothing.
 */
export function languageAlternates(path: string, offered: readonly PlatformLang[]): Record<string, string> | undefined {
  const langs = PLATFORM_LANGS.filter((lang) => lang === "en" || offered.includes(lang));
  if (langs.length < 2) return undefined;
  return {
    ...Object.fromEntries(langs.map((lang) => [PLATFORM_LANG_FACTS[lang].tag, platformPath(lang, path)])),
    "x-default": path,
  };
}

/**
 * The language to suggest to a browser on a page in another one: the first of the browser's languages (`navigator.languages`, in order) the
 * site offers and the page is not in. Norwegian Nynorsk and the bare `no` read Bokmål (`nb`), the written standard the site has. Null when the
 * page is already in the browser's language or the site has none of them.
 */
export function suggestedLang(browser: readonly string[], page: PlatformLang, offered: readonly PlatformLang[]): PlatformLang | null {
  for (const tag of browser) {
    const sub = tag.toLowerCase().split("-")[0];
    const lang = sub === "no" || sub === "nn" ? "nb" : sub;
    if (!isPlatformLang(lang)) continue;
    if (lang === page) return null;
    if (lang === "en" || offered.includes(lang)) return lang;
  }
  return null;
}

/** `platform_settings.locales` for a set of the site's languages: English first, the others in `PLATFORM_LANGS`' order. */
export function localesFor(langs: readonly PlatformLang[]): string[] {
  return PLATFORM_LANGS.filter((lang) => lang === "en" || langs.includes(lang)).map((lang) => PLATFORM_LANG_FACTS[lang].locale);
}
