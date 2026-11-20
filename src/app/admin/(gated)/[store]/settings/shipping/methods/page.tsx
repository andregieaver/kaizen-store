import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { MethodsListView } from "@/components/admin/shipping/methods-list";
import { chosenMarket, MarketTabs } from "@/components/admin/shipping/shipping-parts";
import { ButtonLink, CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { WAY_KEYS } from "@/lib/shipping-ways";
import { adminLangOf, ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { SHIPPING_WORDS } from "@/lib/admin-words/shipping";
import { memberCan, requirePermission } from "@/server/permissions";
import { getShippingSetup } from "@/server/shipping-methods";

import { moveShippingAction } from "../actions";

export const metadata: Metadata = { title: "Shipping methods" };

/** One country's shipping methods (D237 2.1): add, open, reorder; a method's rates are on its own page. */
export default async function ShippingMethodsPage({ params, searchParams }: PageProps<"/admin/[store]/settings/shipping/methods">) {
  const gated = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const all = SHIPPING_WORDS[lang];
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const market = chosenMarket(store.markets, (await searchParams).market);
  const base = `/admin/${store.slug}/settings/shipping`;
  const setup = await getShippingSetup(store.id);
  const methods = market ? setup.methods.filter((m) => m.marketCode === market.code) : [];
  const canWrite = memberCan(gated, "settings:write");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: all.pages.back }}
        title={all.pages.methodsTitle}
        meta={
          market
            ? [
                <span key="lead">
                  <span className="text-ink">
                    {methods.length === 0
                      ? fillWords(all.pages.leadNone, { market: market.name })
                      : countWords(methods.length, all.pages.leadSome, { market: market.name })}
                  </span>
                  {methods.length === 0 ? all.pages.leadNoneRest : all.pages.leadSomeRest}
                </span>,
              ]
            : undefined
        }
        description={market ? undefined : all.pages.methodsDescription}
        actions={
          market && canWrite ? (
            <ButtonLink kind="secondary" href={`${base}/methods/new?market=${market.code}`}>
              {all.pages.writeOwn}
            </ButtonLink>
          ) : undefined
        }
      />
      {market && (
        <>
          <MarketTabs href={(code) => `${base}/methods?market=${code}`} markets={store.markets} current={market.code} label={all.countries} />
          {/* Empty, the sentence and the ways below say it all (round 11, D634); the list and its order come with the first method. */}
          {methods.length > 0 && (
            <MethodsListView
              base={base}
              market={{ code: market.code, name: market.name, currency: market.nativeCurrency }}
              methods={methods}
              canWrite={canWrite}
              words={all.methods}
              locale={locale}
              move={(id, direction) => moveShippingAction.bind(null, store.slug, "methods", market.code, id, direction)}
            />
          )}
          {/* Ways most shops offer (round 11, D634): each opens Add a method filled in; collecting from you is the store's own pickup. */}
          {canWrite && (
            <section aria-labelledby="ways" className="flex flex-col gap-3">
              <h2 id="ways" className="text-title text-ink">
                {all.pages.waysTitle}
              </h2>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-3">
                {WAY_KEYS.map((key, i) => (
                  <li key={key} className={`flex flex-col gap-2 p-5 ${CARD_CLASS}`}>
                    <span className="text-body text-ink">{all.pages.ways[key].title}</span>
                    <span className="text-caption text-ink-2">{all.pages.ways[key].sub}</span>
                    <ButtonLink
                      href={`${base}/methods/new?market=${market.code}&way=${key}`}
                      kind={i === 0 && methods.length === 0 ? "main" : "secondary"}
                      size="dense"
                      className="mt-auto self-start"
                    >
                      {all.pages.addIt}
                      <span className="sr-only"> {all.pages.ways[key].title}</span>
                    </ButtonLink>
                  </li>
                ))}
                <li className={`flex flex-col gap-2 p-5 ${CARD_CLASS}`}>
                  <span className="text-body text-ink">{all.pages.ways.collect.title}</span>
                  <span className="text-caption text-ink-2">{all.pages.ways.collect.sub}</span>
                  <ButtonLink href={`${base}/pickup`} kind="secondary" size="dense" className="mt-auto self-start">
                    {all.pages.addPlace}
                  </ButtonLink>
                </li>
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
