import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ROUND_STEPS } from "@/lib/currency";
import { currencyName, languageName, languageOptions } from "@/lib/localization";
import { fullCatalog, isBuiltIn } from "@/lib/ui-catalog-all";
import { OFFERABLE_CURRENCIES, minorUnitDigits } from "@/lib/money";
import { memberCan, requirePermission } from "@/server/permissions";
import { enabledLanguages } from "@/server/languages";
import { uiCounts } from "@/server/ui-text";

import { fetchRatesAction, saveCurrenciesAction, saveLanguagesAction } from "./actions";

export const metadata: Metadata = { title: "Languages and currencies" };

const input = "min-h-10 rounded-md border border-border bg-background px-3 text-sm";

export default async function LocalizationPage({ params }: PageProps<"/admin/[store]/settings/localization">) {
  const current = await requirePermission((await params).store, "settings:read");
  const { store } = current;
  const owner = memberCan(current, "owner");
  const { localization, markets } = store;
  const [languages, counts] = await Promise.all([enabledLanguages(), uiCounts()]);
  const catalogSize = fullCatalog().length;
  /** Where a language's interface text (buttons, cart, checkout, emails) stands. */
  const interfaceOf = (lang: string) => {
    if (isBuiltIn(lang)) return "Interface written by hand";
    const c = counts[lang];
    if (!c || c.translated === 0) return "Interface in English until the platform translates it";
    const share = Math.min(100, Math.round((c.translated / catalogSize) * 100));
    return `Interface ${share} % translated${c.reviewed >= c.translated ? ", reviewed" : ", not yet reviewed"}`;
  };
  const main = localization.locales[0];
  const ownLanguages = new Set(markets.map((market) => market.ownLocale.split("-")[0]));
  const natives = new Set(markets.map((market) => market.nativeCurrency));
  const offered = new Set(localization.currencies.map((c) => c.currency));
  const currencyOf = new Map(localization.currencies.map((c) => [c.currency, c]));
  // The countries' own first, then the offered ones, then the rest.
  const currencies = [...OFFERABLE_CURRENCIES].sort((a, b) => {
    const rank = (c: string) => (natives.has(c) ? 0 : offered.has(c) ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold">Languages and currencies</h1>
        <p className="text-sm text-muted">
          Language and currency are chosen separately. Offer any languages, whichever countries you sell to, and any
          currencies, whichever languages. Prices are kept in each country&apos;s own currency and shown to a shopper in
          the currency they choose at the rates below. Shoppers choose from the header; the choice is in the address
          (for example <code>/no-en-eur</code>).
        </p>
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="languages">
        <h2 id="languages" className="text-lg font-semibold">Languages</h2>
        <p className="text-sm text-muted">
          Products, pages, menus and emails can be written in each language. The main language is the one you write in
          first; the others are translations. A language a country shows by default cannot be removed.
        </p>
        <ActionForm action={saveLanguagesAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <table className="w-full rounded-lg border border-border bg-background text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Language</th>
                <th scope="col" className="px-4 py-2 font-medium">Offer</th>
                <th scope="col" className="px-4 py-2 font-medium">Main</th>
              </tr>
            </thead>
            <tbody>
              {languageOptions(languages).map(({ lang, locales }) => {
                const current = localization.locales.find((locale) => locale.split("-")[0] === lang);
                const required = ownLanguages.has(lang);
                return (
                  <tr key={lang} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-2 font-normal">
                      {languageName(current ?? locales[0])}
                      {locales.length > 1 && (
                        <select
                          name={`variant:${lang}`}
                          defaultValue={current ?? locales[0]}
                          aria-label={`Variant of ${languageName(locales[0])}`}
                          disabled={!owner}
                          className={`${input} ml-3 min-h-8 py-0`}
                        >
                          {locales.map((locale) => (
                            <option key={locale} value={locale}>{locale}</option>
                          ))}
                        </select>
                      )}
                      <span className="block text-xs text-muted">{interfaceOf(lang)}</span>
                    </th>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        name={`language:${lang}`}
                        defaultChecked={current !== undefined}
                        disabled={!owner || required}
                        aria-label={`Offer ${languageName(locales[0])}`}
                      />
                      {required && <input type="hidden" name={`language:${lang}`} value="on" />}
                      {required && <span className="ml-2 text-xs text-muted">a country&apos;s language</span>}
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="radio"
                        name="main"
                        value={lang}
                        defaultChecked={main?.split("-")[0] === lang}
                        disabled={!owner}
                        aria-label={`${languageName(locales[0])} is the main language`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="text-base font-semibold">Each country&apos;s language</h3>
          <p className="text-sm text-muted">
            What a country shows at its own address (<code>/no</code>). Shoppers can still switch to any other language
            you offer.
          </p>
          <ul className="flex flex-col gap-2">
            {markets.map((market) => (
              <li key={market.code} className="flex items-center justify-between gap-3">
                <label htmlFor={`market-${market.code}`}>{market.name}</label>
                <select
                  id={`market-${market.code}`}
                  name={`market:${market.code}`}
                  defaultValue={market.ownLocale.split("-")[0]}
                  disabled={!owner}
                  className={input}
                >
                  {localization.locales.map((locale) => (
                    <option key={locale} value={locale.split("-")[0]}>{languageName(locale)}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          {owner && <div><SubmitButton>Save languages</SubmitButton></div>}
        </ActionForm>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="currencies">
        <h2 id="currencies" className="text-lg font-semibold">Currencies</h2>
        <p className="text-sm text-muted">
          Rates are units of the currency per 1 euro, as the European Central Bank publishes them. A currency needs a
          rate, and so does each country&apos;s own, before amounts can be shown in it. Converted amounts are rounded to
          the step you choose. Subscriptions and weekly deliveries are only in a country&apos;s own currency.
        </p>
        <ActionForm action={saveCurrenciesAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <table className="w-full rounded-lg border border-border bg-background text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Currency</th>
                <th scope="col" className="px-4 py-2 font-medium">Offer</th>
                <th scope="col" className="px-4 py-2 font-medium">Rate per 1 EUR</th>
                <th scope="col" className="px-4 py-2 font-medium">Round to</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((currency) => {
                const set = currencyOf.get(currency);
                const native = natives.has(currency);
                const digits = minorUnitDigits(currency);
                const step = set ? set.roundTo / 10 ** digits : 0;
                const steps = ROUND_STEPS.includes(step as (typeof ROUND_STEPS)[number]) || step === 1 / 10 ** digits ? ROUND_STEPS : [...ROUND_STEPS, step].sort((a, b) => a - b);
                return (
                  <tr key={currency} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-2 font-normal">
                      {currencyName(currency, main ?? "en")}
                      {native && <span className="ml-2 text-xs text-muted">a country&apos;s currency</span>}
                    </th>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        name={`offer:${currency}`}
                        defaultChecked={native || offered.has(currency)}
                        disabled={!owner || native}
                        aria-label={`Offer ${currency}`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      {currency === "EUR" ? (
                        <span className="text-muted">1</span>
                      ) : (
                        <input
                          name={`rate:${currency}`}
                          inputMode="decimal"
                          defaultValue={set?.rate ?? ""}
                          placeholder="Not set"
                          disabled={!owner}
                          aria-label={`Rate of ${currency} per 1 EUR`}
                          className={`${input} w-32`}
                        />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <select name={`round:${currency}`} defaultValue={String(step)} disabled={!owner} aria-label={`Round ${currency} to`} className={input}>
                        {steps.map((s) => (
                          <option key={s} value={s}>{s === 0 ? "No rounding" : s}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="ratesAuto" defaultChecked={store.ratesAuto} disabled={!owner} />
            Keep the rates up to date from the ECB every day
          </label>
          {store.ratesUpdatedAt && (
            <p className="text-xs text-muted">Rates last updated from the ECB {new Date(store.ratesUpdatedAt).toLocaleString("en-GB")}.</p>
          )}
          {owner && <div><SubmitButton>Save currencies</SubmitButton></div>}
        </ActionForm>
        {owner && (
          <ActionForm action={fetchRatesAction.bind(null, store.slug)}>
            <SubmitButton>Fetch the ECB&apos;s rates now</SubmitButton>
          </ActionForm>
        )}
      </section>
    </div>
  );
}
