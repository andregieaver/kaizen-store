import { canConvert, conversionFactor, defaultRoundTo, toRates, type Rates, type StoreCurrency } from "./currency";
import type { Market } from "./markets";

/**
 * What a store offers in languages and currencies, whatever the countries it
 * sells to (D109). Until an owner chooses, its languages and currencies are
 * those its countries have, so a store that never chose is what it always was.
 */

const languageOf = (locale: string) => locale.split("-")[0];

/**
 * The store's languages: the owner's, main first, and never fewer than every
 * country's own language (a country shown in its own language needs it);
 * else the countries' own, the store's own country first.
 */
export function effectiveLocales(chosen: readonly string[], markets: readonly Market[]): string[] {
  return mergeLocales(chosen, markets.map((market) => market.ownLocale));
}

/** The chosen languages, then the countries' own that they lack, one locale per language. */
export function mergeLocales(chosen: readonly string[], own: readonly string[]): string[] {
  const all = [...chosen, ...own];
  const seen = new Set<string>();
  // One locale per language: the first named wins.
  return all.filter((locale) => {
    const lang = languageOf(locale);
    if (seen.has(lang)) return false;
    seen.add(lang);
    return true;
  });
}

/** The store's currencies: those it chose, and each country's own, with the rates it set (none for a country's own until it does). */
export function effectiveCurrencies(chosen: readonly StoreCurrency[], markets: readonly Market[]): StoreCurrency[] {
  const list = [...chosen];
  for (const market of markets) {
    if (!list.some((c) => c.currency === market.nativeCurrency)) {
      list.push({ currency: market.nativeCurrency, rate: market.nativeCurrency === "EUR" ? 1 : null, roundTo: defaultRoundTo(market.nativeCurrency) });
    }
  }
  return list;
}

export type Localization = {
  /**
   * The store's languages in use, main first: what editors show tabs for and what is translated. With Several languages off (D178) the main
   * language and each offered country's own; translations of the others are kept (`keptLocales`).
   */
  locales: string[];
  /** Every language the store keeps texts in, whatever its features: what a save must not drop. */
  keptLocales: string[];
  /** The currencies offered: each offered country's own and, with Several currencies on, those the store chose. */
  currencies: StoreCurrency[];
  /** The rate of every currency the store keeps (offered or not), so amounts of past orders still convert (analytics). */
  rates: Rates;
  /** A shopper may see a country in another of the store's languages than its own (Several languages on, D178). */
  languageChoice: boolean;
  /** A shopper may see a country's amounts in another currency than its own (Several currencies on, D178). */
  currencyChoice: boolean;
};

/** What the store's features allow (D178): the countries it keeps besides those offered, and whether languages and currencies are chosen. */
export type LocalizationOptions = {
  /** Every active market the owner keeps, the offered ones among them; the offered ones when left out. */
  kept?: readonly Market[];
  /** Several languages is on (true when left out). */
  languages?: boolean;
  /** Several currencies is on (true when left out). */
  currencies?: boolean;
};

/**
 * What a store offers in languages and currencies, from what it chose and the markets it offers. With Several languages off a country is
 * shown in its own language only and the store's languages are its main one and its countries' own; with Several currencies off a country's
 * amounts are in its own currency only. Rates are kept for every currency the store has, offered or not.
 */
export function localizationOf(
  chosenLocales: readonly string[],
  chosenCurrencies: readonly StoreCurrency[],
  markets: readonly Market[],
  options: LocalizationOptions = {},
): Localization {
  const kept = options.kept ?? markets;
  const languages = options.languages !== false;
  const currencyChoice = options.currencies !== false;
  const natives = new Set(markets.map((market) => market.nativeCurrency));
  const currencies = effectiveCurrencies(currencyChoice ? chosenCurrencies : chosenCurrencies.filter((c) => natives.has(c.currency)), markets);
  return {
    // The main language is what everything is written in first, so it stays when the others are hidden.
    locales: languages ? effectiveLocales(chosenLocales, markets) : mergeLocales(chosenLocales.slice(0, 1), markets.map((market) => market.ownLocale)),
    keptLocales: effectiveLocales(chosenLocales, kept),
    currencies,
    rates: toRates(effectiveCurrencies(chosenCurrencies, kept)),
    languageChoice: languages,
    currencyChoice,
  };
}

type Offering = Pick<Localization, "currencies" | "rates"> & { currencyChoice?: boolean };

/** Whether a country whose own currency is `native` may be shown in `currency`. */
export function offers(localization: Offering, native: string, currency: string): boolean {
  if (native === currency) return true;
  if (localization.currencyChoice === false) return false;
  return localization.currencies.some((c) => c.currency === currency) && canConvert(native, currency, localization.rates);
}

/** The currencies a shopper in a country can choose: its own first, then the others the store can convert to. */
export function currencyChoices(localization: Offering, native: string): string[] {
  return [native, ...localization.currencies.map((c) => c.currency).filter((c) => c !== native && offers(localization, native, c))];
}

/** How a country's own currency converts into another the store offers, or null when it cannot be shown in it. */
export function conversionFor(localization: Offering, native: string, currency: string): { factor: number; step: number } | null {
  return offers(localization, native, currency) ? conversionFactor(native, currency, localization.rates) : null;
}

/** The languages a shopper in a country can choose (D109, D178): every language the store is in, or only the country's own. */
export function languageChoices(localization: Pick<Localization, "locales" | "languageChoice">, market: Pick<Market, "ownLocale">): string[] {
  return localization.languageChoice ? localization.locales : [market.ownLocale];
}

/** What an address may ask of a country (`findMarket()`'s choices): the languages and currencies offered now. */
export function marketChoices(localization: Localization): { locales: readonly string[]; conversion: (native: string, currency: string) => { factor: number; step: number } | null } {
  return {
    // With Several languages off no language but a country's own is asked for: its bare address has it.
    locales: localization.languageChoice ? localization.locales : [],
    conversion: (native, currency) => conversionFor(localization, native, currency),
  };
}

/**
 * What an address of something already sold may ask (D178): every language the store keeps and every currency it has a rate for, offered or
 * not, so an order's page, its documents and its links open in the language and currency it was bought in.
 */
export function keptChoices(localization: Localization): { locales: readonly string[]; conversion: (native: string, currency: string) => { factor: number; step: number } | null } {
  return { locales: localization.keptLocales, conversion: (native, currency) => conversionFactor(native, currency, localization.rates) };
}

/** A language's name in itself, as a shopper looks for it: "norsk bokmål", "English". */
export function languageName(locale: string): string {
  const lang = locale.split("-")[0];
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(lang) ?? lang;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

/** A currency as a shopper reads it in their language: "EUR · euro". */
export function currencyName(currency: string, locale: string): string {
  const name = new Intl.DisplayNames([locale], { type: "currency" }).of(currency) ?? currency;
  return `${currency} · ${name}`;
}

/** The languages a store can choose between, from the platform's (D111): each with the variants it can pick (`de-DE`, `de-AT`). */
export function languageOptions(languages: readonly { lang: string; locales: readonly string[] }[]): { lang: string; locales: string[] }[] {
  return languages.map(({ lang, locales }) => ({ lang, locales: [...locales] }));
}

/** Whether a locale is one the platform offers, or a country's own. */
export function isOfferable(languages: readonly { locales: readonly string[] }[], locale: string): boolean {
  return languages.some((language) => language.locales.includes(locale));
}

/**
 * The store's languages and each country's language when one is chosen with Several languages off (D178): `main` first, each country's in,
 * then the others the store keeps texts in. A kept variant of a chosen language gives way ("en-IE" when "en-GB" is chosen), and the main
 * language's variant wins over a country's.
 */
export function oneLanguageChoice(kept: readonly string[], main: string, marketLocales: Record<string, string>): [string[], Record<string, string>] {
  const langOf = (locale: string) => locale.split("-")[0];
  const chosen = [...new Set([main, ...Object.values(marketLocales)])];
  const byLang = new Map<string, string>();
  for (const locale of chosen) if (!byLang.has(langOf(locale))) byLang.set(langOf(locale), locale);
  const pick = (locale: string) => byLang.get(langOf(locale)) ?? locale;
  const locales = [...new Set([...chosen.map(pick), ...kept.filter((locale) => !byLang.has(langOf(locale)))])];
  return [locales, Object.fromEntries(Object.entries(marketLocales).map(([code, locale]) => [code, pick(locale)]))];
}
