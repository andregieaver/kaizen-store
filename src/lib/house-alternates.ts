import { languageChoices, type Localization } from "./localization";
import { inView, ownView, type Market } from "./markets";

/**
 * The language versions of a page of Kaizena Flow's own store (D484, step 5 of `docs/platform-parity-plan.md`), as Kaizena Flow's site has
 * named them since D312 (`languageAlternates()` of `platform-lang.ts`): one per language, by the language alone (`en`, `nb`), and `x-default`
 * the store's own language's (English) address. A store sells in countries, so its tags carry the country (`en-NO`); Kaizena Flow's site is
 * for every country, and an English page named `en-NO` would say it is for Norway alone. Null for any other store: its own rules stand.
 *
 * `path` is the page's address in a market view (`marketMetaPath()` with the page's own path).
 */
export function houseLanguageAlternates(
  store: { house: boolean; markets: readonly Market[]; localization: Pick<Localization, "locales" | "languageChoice"> },
  path: (marketSlug: string) => string,
): Record<string, string> | null {
  if (!store.house) return null;
  const own = store.markets[0];
  if (!own) return null;
  const langs = languageChoices(store.localization, own);
  if (langs.length < 2) return null;
  const versions = langs.map((locale) => [locale.split("-")[0].toLowerCase(), path(inView(own, { locale, currency: own.nativeCurrency }).slug)]);
  return { ...Object.fromEntries(versions), "x-default": path(ownView(own).slug) };
}
