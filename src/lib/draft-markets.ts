/**
 * The markets a draft order can be made in (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.4): a market view is a country the store sells to, shown in a language and a currency the
 * store offers (`{country}[-{lang}][-{currency}]`, D109). The draft is priced and stored in the currency that view shows, so it is chosen first. Pure: the page reads the store's markets and
 * localization and hands plain data to the editor, which builds the address with `draftMarketSlug()` and the server resolves it again with `resolveShop()`.
 */
import { currencyChoices, languageChoices, languageName, type Localization } from "./localization";
import { marketSlug } from "./market-slug";
import type { Market } from "./markets";

export type DraftCountryOption = {
  /** The country, upper case. */
  code: string;
  /** Its name in the language shown at its own address. */
  name: string;
  /** The language and currency its bare address shows. */
  ownLang: string;
  ownCurrency: string;
  /** The currencies the store can show this country in, its own first (D178: its own only with Several currencies off). */
  currencies: string[];
  /** The languages the store can show this country in (D178: its own only with Several languages off). */
  languages: { lang: string; name: string }[];
};

export type DraftMarketOptions = {
  countries: DraftCountryOption[];
  /** The store's languages, main first (language subtags). */
  languages: { lang: string; name: string }[];
};

const langOf = (locale: string) => locale.split("-")[0].toLowerCase();

export function draftMarketOptions(
  markets: readonly Pick<Market, "code" | "name" | "ownLocale" | "nativeCurrency">[],
  localization: Pick<Localization, "locales" | "currencies" | "rates"> & Partial<Pick<Localization, "languageChoice" | "currencyChoice">>,
): DraftMarketOptions {
  const choosing = { locales: localization.locales, languageChoice: localization.languageChoice !== false };
  const seen = new Set<string>();
  const countries: DraftCountryOption[] = [];
  for (const market of markets) {
    if (seen.has(market.code)) continue;
    seen.add(market.code);
    countries.push({
      code: market.code,
      name: market.name,
      ownLang: langOf(market.ownLocale),
      ownCurrency: market.nativeCurrency,
      currencies: currencyChoices(localization, market.nativeCurrency),
      languages: languageChoices(choosing, market).map((locale) => ({ lang: langOf(locale), name: languageName(locale) })),
    });
  }
  return { countries, languages: localization.locales.map((locale) => ({ lang: langOf(locale), name: languageName(locale) })) };
}

/** The address of a country shown in a language and a currency, or null when the store does not offer that country, language or currency. */
export function draftMarketSlug(options: DraftMarketOptions, choice: { country: string; lang: string; currency: string }): string | null {
  const country = options.countries.find((c) => c.code === choice.country.toUpperCase());
  if (!country) return null;
  if (!country.languages.some((l) => l.lang === choice.lang.toLowerCase())) return null;
  if (!country.currencies.includes(choice.currency.toUpperCase())) return null;
  return marketSlug(country.code, { lang: choice.lang.toLowerCase(), currency: choice.currency.toUpperCase() }, { lang: country.ownLang, currency: country.ownCurrency });
}

/** What a market address stands for, to fill the editor's three selects from a draft's `marketSlug` (the country's own language and currency where the address leaves them out). */
export function draftMarketChoice(options: DraftMarketOptions, slug: string): { country: string; lang: string; currency: string } | null {
  const match = /^([a-z]{2})(?:-([a-z]{2}))?(?:-([a-z]{3}))?$/.exec(slug);
  if (!match) return null;
  const country = options.countries.find((c) => c.code === match[1].toUpperCase());
  if (!country) return null;
  return { country: country.code, lang: match[2] ?? country.ownLang, currency: match[3] ? match[3].toUpperCase() : country.ownCurrency };
}
