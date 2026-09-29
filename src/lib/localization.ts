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
  /** The store's languages, main first. */
  locales: string[];
  currencies: StoreCurrency[];
  rates: Rates;
};

export function localizationOf(chosenLocales: readonly string[], chosenCurrencies: readonly StoreCurrency[], markets: readonly Market[]): Localization {
  const currencies = effectiveCurrencies(chosenCurrencies, markets);
  return { locales: effectiveLocales(chosenLocales, markets), currencies, rates: toRates(currencies) };
}

/** Whether a country whose own currency is `native` may be shown in `currency`. */
export function offers(localization: Pick<Localization, "currencies" | "rates">, native: string, currency: string): boolean {
  if (native === currency) return true;
  return localization.currencies.some((c) => c.currency === currency) && canConvert(native, currency, localization.rates);
}

/** The currencies a shopper in a country can choose: its own first, then the others the store can convert to. */
export function currencyChoices(localization: Pick<Localization, "currencies" | "rates">, native: string): string[] {
  return [native, ...localization.currencies.map((c) => c.currency).filter((c) => c !== native && offers(localization, native, c))];
}

/** How a country's own currency converts into another the store offers, or null when it cannot be shown in it. */
export function conversionFor(localization: Pick<Localization, "currencies" | "rates">, native: string, currency: string): { factor: number; step: number } | null {
  return offers(localization, native, currency) ? conversionFactor(native, currency, localization.rates) : null;
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

/**
 * The languages a store can offer, as the locales its shoppers read numbers
 * and dates in: every country's own, and English for anyone. A store has one
 * variant of each language.
 */
export const OFFERABLE_LOCALES: readonly string[] = [
  "en-GB", "en-IE", "en-MT",
  "nb-NO", "sv-SE", "sv-FI", "da-DK", "fi-FI",
  "de-DE", "de-AT", "de-BE", "de-LU",
  "nl-NL", "nl-BE", "fr-FR", "fr-BE", "fr-LU", "es-ES", "it-IT", "pt-PT", "pl-PL",
  "cs-CZ", "sk-SK", "hu-HU", "ro-RO", "bg-BG", "el-GR", "el-CY", "hr-HR", "sl-SI",
  "et-EE", "lv-LV", "lt-LT", "mt-MT", "ga-IE", "lb-LU",
];

/** The languages there are to choose from, each with the variants a store can pick between. */
export function languageOptions(): { lang: string; locales: string[] }[] {
  const byLanguage = new Map<string, string[]>();
  for (const locale of OFFERABLE_LOCALES) {
    const lang = languageOf(locale);
    byLanguage.set(lang, [...(byLanguage.get(lang) ?? []), locale]);
  }
  return [...byLanguage].map(([lang, locales]) => ({ lang, locales }));
}
