import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { FeatureOffNote } from "@/components/admin/feature-off";
import { ROUND_STEPS } from "@/lib/currency";
import { currencyName, languageName, languageOptions } from "@/lib/localization";
import { fullCatalog, isBuiltIn } from "@/lib/ui-catalog-all";
import { OFFERABLE_CURRENCIES, minorUnitDigits } from "@/lib/money";
import { featureOn } from "@/lib/store-features";
import { memberCan, requirePermission } from "@/server/permissions";
import { enabledLanguages } from "@/server/languages";
import { uiCounts } from "@/server/ui-text";
import { PageHeader } from "@/components/admin/ui";

import { fetchRatesAction, saveCurrenciesAction, saveLanguagesAction, saveStoreLanguageAction } from "./actions";

export const metadata: Metadata = { title: "Languages and currencies" };

const input = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";

export default async function LocalizationPage({ params }: PageProps<"/admin/[store]/settings/localization">) {
  const current = await requirePermission((await params).store, "settings:read");
  const { store } = current;
  const owner = memberCan(current, "owner");
  const lang = adminLangOf(current.account.adminLocale);
  const w = adminText(lang, "settings").localization;
  const { localization, markets } = store;
  // Several languages and Several currencies (D178): each section is there while its feature is on; what was chosen is kept while off.
  const languagesOn = featureOn(store, "languages");
  const currenciesOn = featureOn(store, "currencies");
  const [languages, counts] = await Promise.all([enabledLanguages(), uiCounts()]);
  const catalogSize = fullCatalog().length;
  /** Where a language's interface text (buttons, cart, checkout, emails) stands. */
  const interfaceOf = (code: string) => {
    if (isBuiltIn(code)) return w.byHand;
    const c = counts[code];
    if (!c || c.translated === 0) return w.untranslated;
    const share = Math.min(100, Math.round((c.translated / catalogSize) * 100));
    return `${fillWords(w.translated, { share })}${c.reviewed >= c.translated ? w.reviewed : w.notReviewed}`;
  };
  const main = localization.locales[0];
  // Every variant of every language the platform offers (D111), for the one-language choice while Several languages is off.
  const allLocales = languageOptions(languages).flatMap(({ locales }) => locales);
  // Every country the store keeps, offered or not, keeps its language and currency.
  const ownLanguages = new Set(store.keptMarkets.map((market) => market.ownLocale.split("-")[0]));
  const natives = new Set(store.keptMarkets.map((market) => market.nativeCurrency));
  const offered = new Set(localization.currencies.map((c) => c.currency));
  const currencyOf = new Map(localization.currencies.map((c) => [c.currency, c]));
  // The countries' own first, then the offered ones, then the rest.
  const currencies = [...OFFERABLE_CURRENCIES].sort((a, b) => {
    const rank = (c: string) => (natives.has(c) ? 0 : offered.has(c) ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title={w.title} description={<Example text={w.description} code="/no-en-eur" />} />

      <section className="flex flex-col gap-4" aria-labelledby="languages">
        <h2 id="languages" className="text-title text-ink">{w.languages}</h2>
        <p className="text-sm text-muted">{w.languagesText}</p>
        {!languagesOn ? (
          <>
            <ActionForm action={saveStoreLanguageAction.bind(null, store.slug)} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="main-language" className="text-sm font-medium">{w.mainLanguage}</label>
                <select id="main-language" name="main" defaultValue={main} disabled={!owner} className={input}>
                  {allLocales.map((locale) => (
                    <option key={locale} value={locale}>{languageName(locale)} ({locale})</option>
                  ))}
                </select>
              </div>
              <h3 className="text-body-strong text-ink">{w.countryLanguage}</h3>
              <p className="text-sm text-muted">
                <Example text={w.countryLanguageOne} code="/no" />
              </p>
              <ul className="flex flex-col gap-2">
                {markets.map((market) => (
                  <li key={market.code} className="flex items-center justify-between gap-3">
                    <label htmlFor={`market-${market.code}`}>{market.name}</label>
                    <select id={`market-${market.code}`} name={`market:${market.code}`} defaultValue={market.ownLocale} disabled={!owner} className={input}>
                      {allLocales.map((locale) => (
                        <option key={locale} value={locale}>{languageName(locale)} ({locale})</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              {owner && <div><SubmitButton>{w.saveLanguage}</SubmitButton></div>}
            </ActionForm>
            <FeatureOffNote storeSlug={store.slug} feature="languages" owner={owner} what={w.moreLanguages} />
          </>
        ) : (
        <ActionForm action={saveLanguagesAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <table className="w-full rounded-panel border border-line bg-card text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-2 font-medium">{w.language}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.offer}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.main}</th>
              </tr>
            </thead>
            <tbody>
              {languageOptions(languages).map(({ lang: code, locales }) => {
                const current = localization.locales.find((locale) => locale.split("-")[0] === code);
                const required = ownLanguages.has(code);
                return (
                  <tr key={code} className="border-b border-line last:border-0">
                    <th scope="row" className="px-4 py-2 font-normal">
                      {languageName(current ?? locales[0])}
                      {locales.length > 1 && (
                        <select
                          name={`variant:${code}`}
                          defaultValue={current ?? locales[0]}
                          aria-label={fillWords(w.variantOf, { language: languageName(locales[0]) })}
                          disabled={!owner}
                          className={`${input} ml-3 min-h-8 py-0`}
                        >
                          {locales.map((locale) => (
                            <option key={locale} value={locale}>{locale}</option>
                          ))}
                        </select>
                      )}
                      <span className="block text-xs text-muted">{interfaceOf(code)}</span>
                    </th>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        name={`language:${code}`}
                        defaultChecked={current !== undefined}
                        disabled={!owner || required}
                        aria-label={fillWords(w.offerLanguage, { language: languageName(locales[0]) })}
                      />
                      {required && <input type="hidden" name={`language:${code}`} value="on" />}
                      {required && <span className="ml-2 text-xs text-muted">{w.countrysLanguage}</span>}
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="radio"
                        name="main"
                        value={code}
                        defaultChecked={main?.split("-")[0] === code}
                        disabled={!owner}
                        aria-label={fillWords(w.isMain, { language: languageName(locales[0]) })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="text-body-strong text-ink">{w.countryLanguage}</h3>
          <p className="text-sm text-muted">
            <Example text={w.countryLanguageSeveral} code="/no" />
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
          {owner && <div><SubmitButton>{w.saveLanguages}</SubmitButton></div>}
        </ActionForm>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="currencies">
        <h2 id="currencies" className="text-title text-ink">{w.currencies}</h2>
        <p className="text-sm text-muted">{w.currenciesText}</p>
        {!currenciesOn ? (
          <FeatureOffNote storeSlug={store.slug} feature="currencies" owner={owner} what={w.moreCurrencies} />
        ) : (
        <>
        <ActionForm action={saveCurrenciesAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <table className="w-full rounded-panel border border-line bg-card text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-2 font-medium">{w.currency}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.offer}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.rate}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.roundTo}</th>
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
                  <tr key={currency} className="border-b border-line last:border-0">
                    <th scope="row" className="px-4 py-2 font-normal">
                      {currencyName(currency, ADMIN_LANG_FACTS[lang].locale)}
                      {native && <span className="ml-2 text-xs text-muted">{w.countrysCurrency}</span>}
                    </th>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        name={`offer:${currency}`}
                        defaultChecked={native || offered.has(currency)}
                        disabled={!owner || native}
                        aria-label={fillWords(w.offerCurrency, { currency })}
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
                          placeholder={w.notSet}
                          disabled={!owner}
                          aria-label={fillWords(w.rateOf, { currency })}
                          className={`${input} w-32`}
                        />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <select name={`round:${currency}`} defaultValue={String(step)} disabled={!owner} aria-label={fillWords(w.roundCurrency, { currency })} className={input}>
                        {steps.map((s) => (
                          <option key={s} value={s}>{s === 0 ? w.noRounding : s.toLocaleString(ADMIN_LANG_FACTS[lang].locale)}</option>
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
            {w.auto}
          </label>
          {store.ratesUpdatedAt && (
            <p className="text-xs text-muted">{fillWords(w.updated, { when: new Date(store.ratesUpdatedAt).toLocaleString(ADMIN_LANG_FACTS[lang].locale) })}</p>
          )}
          {owner && <div><SubmitButton>{w.saveCurrencies}</SubmitButton></div>}
        </ActionForm>
        {owner && (
          <ActionForm action={fetchRatesAction.bind(null, store.slug)}>
            <SubmitButton>{w.fetch}</SubmitButton>
          </ActionForm>
        )}
        </>
        )}
      </section>
    </div>
  );
}

/** A sentence with an address in it as code: `{example}` in the words is the code. */
function Example({ text, code }: { text: string; code: string }) {
  const [before, after = ""] = text.split("{example}");
  return (
    <>
      {before}
      <code>{code}</code>
      {after}
    </>
  );
}
