/**
 * Which of a store's languages a visitor is first shown (D474), and the currency that goes with a language. Pure: the proxy, the store's
 * front door, the language switcher and the tests share it.
 *
 * A store with several languages chooses how a visitor who has not chosen is shown one (`stores.language_rule`):
 *
 * - `own`: the country's own language, at its bare address, as every store was before (the default);
 * - `location`: the language of the country the visitor is in (`x-vercel-ip-country`), where the store has it;
 * - `location-browser`: the browser's language where the store has one of those it asks for, else the country the visitor is in;
 * - `browser`: the browser's language (`Accept-Language`), where the store has it.
 *
 * Whatever the rule, a language the visitor chose in the language switcher (remembered in `kaizen_lang_{storeId}`) comes first. A choice
 * that finds none of the store's languages leaves the address as it is. Only the front door is decided this way (an address that names no
 * language and no country, `languageAtDoor()`): a link to a page in a language is never moved to another, as the Geo-blocking Regulation
 * (EU 2018/302, art. 3(2)) asks of a choice made by where the visitor is, and as a search engine needs of each language's addresses.
 */

export const LANGUAGE_RULES = ["own", "location", "location-browser", "browser"] as const;
export type LanguageRule = (typeof LANGUAGE_RULES)[number];

export const isLanguageRule = (value: unknown): value is LanguageRule => typeof value === "string" && (LANGUAGE_RULES as readonly string[]).includes(value);

/** The cookie that keeps a visitor's own choice of language for a store (D474): set only when they choose one in the switcher. */
export const languageCookieName = (storeId: string): string => `kaizen_lang_${storeId}`;
/** How long the choice is kept. */
export const LANGUAGE_COOKIE_DAYS = 365;

/** The cookie a visitor's choice of a language sets (`document.cookie`), for the whole of the site it is chosen on; null for no language. */
export function languageCookie(storeId: string, lang: string | undefined, secure: boolean): string | null {
  const code = lang?.split("-")[0].toLowerCase() ?? "";
  if (!/^[a-z]{2}$/.test(code) || !/^[0-9a-f-]{36}$/.test(storeId)) return null;
  return `${languageCookieName(storeId)}=${code}; Path=/; Max-Age=${LANGUAGE_COOKIE_DAYS * 86_400}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

const LANG = /^[a-z]{2}$/;

/** Tags a browser may send for a language the stores write in another way: Norwegian (`no`) and Nynorsk read Bokmål. */
const ALIASES: Readonly<Record<string, readonly string[]>> = { no: ["nb"], nn: ["nb"] };

/**
 * The languages a browser asks for (`Accept-Language`), best first, as two-letter codes: `nb-NO,nb;q=0.9,en;q=0.7` → `["nb", "en"]`.
 * Weights of 0, wildcards and tags that are not a two-letter language are left out; at most 12.
 */
export function browserLanguages(header: string | null | undefined): string[] {
  if (!header) return [];
  const weighed = header
    .slice(0, 500)
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return { lang: tag.trim().split("-")[0].toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => LANG.test(entry.lang) && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return [...new Set(weighed.map((entry) => entry.lang))].slice(0, 12);
}

/**
 * The languages people in a country read, the most read first: what `location` offers a visitor there. Europe's countries and a few
 * others a European store sells to; a country not here offers none, and the address is left as it is.
 */
export const COUNTRY_LANGUAGES: Readonly<Record<string, readonly string[]>> = {
  AT: ["de"],
  BE: ["nl", "fr", "de"],
  BG: ["bg"],
  CH: ["de", "fr", "it"],
  CY: ["el"],
  CZ: ["cs"],
  DE: ["de"],
  DK: ["da"],
  EE: ["et"],
  ES: ["es"],
  FI: ["fi", "sv"],
  FR: ["fr"],
  GB: ["en"],
  GR: ["el"],
  HR: ["hr"],
  HU: ["hu"],
  IE: ["en", "ga"],
  IS: ["is"],
  IT: ["it"],
  LI: ["de"],
  LT: ["lt"],
  LU: ["fr", "de", "lb"],
  LV: ["lv"],
  MT: ["mt", "en"],
  NL: ["nl"],
  NO: ["nb"],
  PL: ["pl"],
  PT: ["pt"],
  RO: ["ro"],
  SE: ["sv"],
  SI: ["sl"],
  SK: ["sk"],
  US: ["en"],
  CA: ["en", "fr"],
  AU: ["en"],
  NZ: ["en"],
};

/** What is known of a visitor when they come to the front door. */
export type Visitor = {
  /** The country they are in, two letters (`x-vercel-ip-country`). */
  country?: string | null;
  /** Their browser's `Accept-Language`. */
  acceptLanguage?: string | null;
  /** The language they chose in the switcher before (`kaizen_lang_{storeId}`). */
  remembered?: string | null;
};

/**
 * The language a visitor is shown at the front door, from the store's rule and the languages it offers there (two letters, its own among
 * them), or null when nothing decides one: the address's own then. The visitor's own earlier choice comes first, under every rule.
 */
export function chosenLanguage(rule: LanguageRule, offered: readonly string[], visitor: Visitor): string | null {
  const has = (lang: string) => offered.includes(lang);
  const remembered = visitor.remembered?.trim().toLowerCase() ?? "";
  if (LANG.test(remembered) && has(remembered)) return remembered;
  const fromBrowser = (): string | null => {
    for (const lang of browserLanguages(visitor.acceptLanguage)) {
      const found = [lang, ...(ALIASES[lang] ?? [])].find(has);
      if (found) return found;
    }
    return null;
  };
  const fromLocation = (): string | null => {
    const country = visitor.country?.trim().toUpperCase() ?? "";
    return (COUNTRY_LANGUAGES[country] ?? []).find(has) ?? null;
  };
  switch (rule) {
    case "own":
      return null;
    case "browser":
      return fromBrowser();
    case "location":
      return fromLocation();
    case "location-browser":
      return fromBrowser() ?? fromLocation();
  }
}

// ---------------------------------------------------------------------------
// The currency that goes with a language
// ---------------------------------------------------------------------------

/** Each country's currency, for those a store can offer (`OFFERABLE_CURRENCIES`). Bulgaria pays in euro from 2026. */
const REGION_CURRENCY: Readonly<Record<string, string>> = {
  AT: "EUR", BE: "EUR", BG: "EUR", CY: "EUR", DE: "EUR", EE: "EUR", ES: "EUR", FI: "EUR", FR: "EUR", GR: "EUR", HR: "EUR", IE: "EUR",
  IT: "EUR", LT: "EUR", LU: "EUR", LV: "EUR", MT: "EUR", NL: "EUR", PT: "EUR", SI: "EUR", SK: "EUR",
  CZ: "CZK", DK: "DKK", HU: "HUF", NO: "NOK", PL: "PLN", RO: "RON", SE: "SEK",
  CH: "CHF", LI: "CHF", GB: "GBP", US: "USD",
};

/** The currency of the country a language's variant names (`en-IE` → EUR, `sv-SE` → SEK), or null for a variant without a country we know. */
export function regionCurrency(locale: string): string | null {
  const region = locale.split("-")[1]?.toUpperCase();
  return (region && REGION_CURRENCY[region]) || null;
}

/** An owner's choice for a language: a currency, or `own` for the country's own whatever the language's variant. */
export const OWN_CURRENCY = "own";

/**
 * The currency each of the store's languages is shown in while the currency follows the language (D474), two-letter language to currency:
 * the owner's choice for it, else the currency of the country its variant names, where the store offers that currency. A language without
 * one (or chosen `own`) keeps the country's own currency.
 */
export function languageCurrencies(locales: readonly string[], chosen: Readonly<Record<string, string>>, offered: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of locales) {
    const lang = locale.split("-")[0].toLowerCase();
    const pick = chosen[lang];
    if (pick === OWN_CURRENCY) continue;
    const currency = pick ?? regionCurrency(locale);
    if (currency && offered.includes(currency)) out[lang] = currency;
  }
  return out;
}

/**
 * The currency a country is shown in when a visitor takes a language there. While the currency follows the language (`byLanguage` given),
 * the language's own where the country can be shown in it, else the country's own; otherwise the currency they have now (`current`).
 */
export function currencyForLanguage(
  lang: string,
  { byLanguage, current, native, canShow }: { byLanguage: Readonly<Record<string, string>> | null; current: string; native: string; canShow: (currency: string) => boolean },
): string {
  if (!byLanguage) return current;
  const currency = byLanguage[lang];
  return currency && canShow(currency) ? currency : native;
}
