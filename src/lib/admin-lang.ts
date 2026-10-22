/**
 * The languages the admin is shown in (D312 A0, `docs/platform-admin-i18n.md` 2 decision 2 and 3.3): per account, never per store, so a
 * person working in two stores reads one admin. The account keeps its choice (`accounts.admin_locale`), first set from the browser at the
 * first sign-in; English is the source and the fallback.
 *
 * Pure: the layouts, the account menu, Your account and the sign-in read these.
 */

/** The admin's languages, English first. A new one is a code here, its catalogues (`src/lib/admin-messages/*.{lang}.ts`) and the check. */
export const ADMIN_LANGS = ["en", "nb"] as const;
export type AdminLang = (typeof ADMIN_LANGS)[number];

type AdminLangFacts = {
  /** What `accounts.admin_locale` keeps. */
  stored: string;
  /** `<html lang>`. */
  tag: string;
  /** The BCP 47 locale for dates, numbers and money (`Intl`). */
  locale: string;
  /** The language's own name, which the choice shows whatever the admin is in. */
  name: string;
};

export const ADMIN_LANG_FACTS: Record<AdminLang, AdminLangFacts> = {
  en: { stored: "en", tag: "en", locale: "en-GB", name: "English" },
  nb: { stored: "nb-NO", tag: "nb", locale: "nb-NO", name: "Norsk" },
};

export function isAdminLang(value: unknown): value is AdminLang {
  return typeof value === "string" && (ADMIN_LANGS as readonly string[]).includes(value);
}

/** The language an account's `admin_locale` stands for; English for none or one no longer offered. */
export function adminLangOf(stored: string | null | undefined): AdminLang {
  return ADMIN_LANGS.find((lang) => ADMIN_LANG_FACTS[lang].stored === stored) ?? "en";
}

/** What `admin_locale` keeps for a language. */
export function storedAdminLocale(lang: AdminLang): string {
  return ADMIN_LANG_FACTS[lang].stored;
}

/** Norwegian in any of its written forms; Nynorsk and plain `no` read the Bokmål admin, the nearest one there is. */
const NORWEGIAN = new Set(["nb", "nn", "no"]);

/**
 * The admin's language for a browser's `Accept-Language` at a first sign-in: the first language it asks for that the admin has, by its
 * order (weights in order of `q`), else English.
 */
export function browserAdminLang(acceptLanguage: string | null | undefined): AdminLang {
  if (!acceptLanguage) return "en";
  const asked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { sub: tag.trim().toLowerCase().split("-")[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.sub && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { sub } of asked) {
    if (sub === "en") return "en";
    if (NORWEGIAN.has(sub)) return "nb";
  }
  return "en";
}

/** Where the browser keeps the admin's language, so `<html lang>` is right before the page is drawn (like the scheme, D221). */
export const ADMIN_LANG_KEY = "kaizen_admin_lang";

/** The admin's first script's part for the language: the browser's copy of the account's language on `<html lang>`. */
export function adminLangScript(): string {
  const tags = JSON.stringify(Object.fromEntries(ADMIN_LANGS.map((lang) => [lang, ADMIN_LANG_FACTS[lang].tag])));
  return `try{var l=localStorage.getItem(${JSON.stringify(ADMIN_LANG_KEY)});var t=${tags}[l];if(t)document.documentElement.lang=t}catch(e){}`;
}
