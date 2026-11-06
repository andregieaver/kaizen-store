import { chosenLanguage, currencyForLanguage, type Visitor } from "./language-rule";
import { languageChoices, offers, type Localization } from "./localization";
import { marketSlug } from "./market-slug";
import type { Market } from "./markets";

/**
 * The views of a country that a language leads to (D479), pure: the language switcher's links, and the country chooser's for a visitor the
 * store's rule picks a language for. Kept apart from `language-rule.ts`, which `localization.ts` itself reads.
 */

type Shown = Pick<Market, "code" | "ownLocale" | "nativeCurrency" | "currency">;
type Offer = Pick<Localization, "locales" | "languageChoice" | "currencies" | "rates" | "currencyChoice" | "currencyByLanguage">;

const langOf = (locale: string) => locale.split("-")[0].toLowerCase();

/**
 * The market slug a country is shown in when a visitor takes `lang` there: that language, and with it its currency while the currency
 * follows the language (else the currency they have now).
 */
export function languageSlug(market: Shown, localization: Offer, lang: string): string {
  const own = { lang: langOf(market.ownLocale), currency: market.nativeCurrency };
  const currency = currencyForLanguage(lang, {
    byLanguage: localization.currencyByLanguage ?? null,
    current: market.currency,
    native: market.nativeCurrency,
    canShow: (c) => offers(localization, market.nativeCurrency, c),
  });
  return marketSlug(market.code, { lang, currency }, own);
}

/**
 * The market slug a country is first shown in to a visitor (D479): the language their own earlier choice or the store's rule picks among
 * those the country offers, with its currency while the currency follows the language; the country's own view where nothing decides.
 */
export function firstSlug(market: Shown, localization: Offer & Pick<Localization, "languageRule">, visitor: Visitor): string {
  const offered = languageChoices(localization, market).map(langOf);
  const lang = chosenLanguage(localization.languageRule ?? "own", offered, visitor) ?? langOf(market.ownLocale);
  return languageSlug({ ...market, currency: market.nativeCurrency }, localization, lang);
}
