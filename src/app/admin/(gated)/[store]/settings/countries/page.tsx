import type { Metadata } from "next";
import Link from "next/link";

import { AdminTextScope } from "@/components/admin/admin-text";
import { CountriesForm } from "@/components/admin/countries-form";
import { MarketPriceRules } from "@/components/admin/market-price-rules";
import { FeatureOffNote } from "@/components/admin/feature-off";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { featureOn } from "@/lib/store-features";
import { marketPriceRules } from "@/server/market-prices";
import { memberCan, requirePermission } from "@/server/permissions";
import { listCountries } from "@/server/stores";
import { ButtonLink, CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { previewPriceRuleAction, removePriceRuleAction, saveCountriesSettingsAction, savePriceRuleAction } from "./actions";

export const metadata: Metadata = { title: "Countries" };

/**
 * The countries the store sells to (D178, `docs/store-features.md` 4d): its own country and, while Several countries is on, the others, each
 * with its own prices, shipping, language and currency. With the feature off the store sells in its own country alone; the others it keeps
 * stay on its list, with their prices and settings, for when the feature is on again. With several countries, each one's prices can be worked out
 * from another's (D335 A.2, `MarketPriceRules`).
 */
export default async function CountriesPage({ params }: PageProps<"/admin/[store]/settings/countries">) {
  const current = await requirePermission((await params).store, "settings:read");
  const { store } = current;
  const owner = memberCan(current, "owner");
  const editor = memberCan(current, "settings:write");
  const several = featureOn(store, "countries");
  const countries = await listCountries();
  const nameOf = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  const [home, ...others] = store.keptMarkets;
  const lang = adminLangOf(current.account.adminLocale);
  const all = adminText(lang, "settings");
  const w = all.countries;
  // "{country}, in {currency}. … under {company} …": the parts around the two filled in by elements.
  const [beforeCompany, afterCompany = ""] = w.ownText.split("{company}");
  const [beforeCountry, afterCountry = ""] = beforeCompany.split("{country}");
  const ruled = several && store.keptMarkets.length > 1 ? await marketPriceRules(store.id) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        meta={[
          <span key="lead">
            <span className="text-ink">
              {several || !home
                ? countWords(store.keptMarkets.length, w.leadSeveral)
                : fillWords(w.leadOne, { country: nameOf(home.code), currency: home.nativeCurrency })}
            </span>
            {w.leadRest}
          </span>,
        ]}
      />

      {several || !home ? (
        <>
        <section aria-labelledby="home-heading" className="flex flex-col gap-2 rounded-panel bg-sunken p-4">
          <h2 id="home-heading" className="text-title text-ink">{w.own}</h2>
          {home ? (
            <p className="text-sm">
              {beforeCountry}
              <strong>{nameOf(home.code)}</strong>
              {fillWords(afterCountry, { currency: home.nativeCurrency })}
              <Link href={`/admin/${store.slug}/settings/company`} className="underline">{all.company.title}</Link>
              {afterCompany}
            </p>
          ) : (
            <p className="text-sm">{w.none}</p>
          )}
          {!several && others.length > 0 && <p className="text-sm text-muted">{fillWords(w.kept, { list: others.map((m) => nameOf(m.code)).join(", ") })}</p>}
        </section>

        {!several && <FeatureOffNote storeSlug={store.slug} feature="countries" owner={owner} what={w.sellingAbroad} />}

        <CountriesForm
          action={saveCountriesSettingsAction.bind(null, store.slug)}
          countries={countries}
          chosen={store.keptMarkets.map((m) => m.code)}
          several={several}
          submitLabel={w.save}
          disabled={!editor}
          w={adminText(lang, "setup").countriesForm}
          note={<p className="text-sm text-muted">{several ? w.noteSeveral : w.noteOne}</p>}
        />
        </>
      ) : (
        // One country (round 11, D634): it as a row with Change country (today's form, folded), and selling in more as a row of its own.
        <section aria-labelledby="where" className={`${CARD_CLASS} px-6 py-3`}>
          <h2 id="where" className="mt-2 mb-1 text-title text-ink">{w.where}</h2>
          <ul className="divide-y divide-line">
            <li>
              <details>
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 flex-col">
                    <span className="text-body text-ink">{nameOf(home.code)}</span>
                    <span className="text-caption text-ink-2">{fillWords(w.ownSub, { currency: home.nativeCurrency })}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-ink underline underline-offset-2">{w.changeCountry}</span>
                </summary>
                <div className="pb-5">
                  <CountriesForm
                    action={saveCountriesSettingsAction.bind(null, store.slug)}
                    countries={countries}
                    chosen={store.keptMarkets.map((m) => m.code)}
                    several={several}
                    submitLabel={w.save}
                    disabled={!editor}
                    w={adminText(lang, "setup").countriesForm}
                    note={<p className="text-sm text-muted">{w.noteOne}</p>}
                  />
                </div>
              </details>
            </li>
            <li className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3">
              <span className="flex min-w-0 flex-col">
                <span className="text-body text-ink">{w.more}</span>
                <span className="text-caption text-ink-2">
                  {others.length > 0 ? fillWords(w.moreKept, { list: others.map((m) => nameOf(m.code)).join(", ") }) : w.moreNew}
                </span>
              </span>
              {owner ? (
                <ButtonLink kind="secondary" href={`/admin/${store.slug}/settings/features`}>
                  {w.sellInMore}
                </ButtonLink>
              ) : (
                <span className="text-caption text-muted">{w.moreOwner}</span>
              )}
            </li>
          </ul>
        </section>
      )}
      {!editor && <p className="text-sm">{all.common.readOnly}</p>}

      {ruled && (
        <AdminTextScope texts={adminTexts(lang, ["settings"])}>
          <MarketPriceRules
            markets={store.keptMarkets.map((m) => ({ code: m.code, name: nameOf(m.code), currency: m.nativeCurrency }))}
            rules={ruled}
            locale={ADMIN_LANG_FACTS[lang].locale}
            editable={editor}
            preview={previewPriceRuleAction.bind(null, store.slug)}
            save={savePriceRuleAction.bind(null, store.slug)}
            remove={removePriceRuleAction.bind(null, store.slug)}
          />
        </AdminTextScope>
      )}
    </div>
  );
}
