import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CustomFieldGroups } from "@/components/custom-fields-view";
import { ProductGrid, ProductListingFor } from "@/components/product-listing";
import { RolePage } from "@/components/role-page";
import { groupsToShow } from "@/lib/field-parts";
import { t } from "@/lib/i18n";
import { languageChoices } from "@/lib/localization";
import type { Market } from "@/lib/markets";
import { inView } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { termMetaDescription, termMetaTitle, termShare } from "@/lib/term-seo";
import type { StoreQuery } from "@/lib/store-parts";
import { featureOn } from "@/lib/store-features";
import { byName, withDescendants, type TermKind } from "@/lib/taxonomy";
import { campaignNotices } from "@/server/campaign-notices";
import { listGridProducts } from "@/server/catalog";
import { shownFieldsFor } from "@/server/custom-fields";
import { missOrRedirect } from "@/server/redirect-resolve";
import { listIndexedTerms, storeShareImage, storeShareTags } from "@/server/seo";
import { marketMoved, resolveShop } from "@/server/shop";
import type { Store } from "@/server/stores";
import { siteTerms } from "@/server/taxonomy";

/**
 * A store's products in one category (with its subcategories) or with one
 * tag (D50): where the store's menu links to them lead. Shared by the
 * `category/[slug]` and `tag/[slug]` routes.
 */

type Params = Promise<{ store: string; market: string; slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Prerender each category or tag known at build time; later ones render on first visit. */
export async function termStaticParams(kind: TermKind, params: { store: string; market: string }) {
  const shop = await resolveShop(params.store, params.market);
  const terms = shop ? (await siteTerms(shop.store.id, "product")).filter((t) => t.kind === kind) : [];
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return terms.length > 0 ? terms.map((term) => ({ slug: term.slug })) : [{ slug: "_" }];
}

async function load(kind: TermKind, params: Params) {
  const { store: storeSlug, market: marketSlug, slug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  // A website (D178 step 5: the online shop off) has no category or tag pages of products: `missed()` gives the 404, or a manual redirect.
  if (!shop || !featureOn(shop.store, "shop")) return null;
  const terms = await siteTerms(shop.store.id, "product");
  const term = terms.find((t) => t.kind === kind && t.slug === slug);
  return term ? { ...shop, terms, term } : null;
}

/**
 * The category's or tag's search and sharing details (wave 2, D168, `docs/wave-2-redirects.md` 2.4.1): the SEO title and description of the market's language
 * as written (the title without the store's name, as a product's is), else the name and the store's own description as before; never another language's text.
 * Every market and language view where the term has a live product is an alternate, and the canonical is the page's own address.
 */
export async function termMetadata(kind: TermKind, params: Params): Promise<Metadata> {
  const loaded = await load(kind, params);
  if (!loaded) return {};
  const { store, market, term } = loaded;
  const path = (m: Market) => marketPath(store.slug, m.slug, `/${kind}/${term.slug}`);
  const fallback = store.seo.description[market.locale] || t(market.lang).storeSummary(store.name, market.name);
  const description = termMetaDescription(term, market.locale, fallback);
  const share = termShare(term, market.locale, fallback);
  // The language's own title is used as written; without one the name goes in and the layout's template adds the store (`Name · Store`, once).
  const ownTitle = termMetaTitle(term, market.locale, store.name);
  // The term's page in the other markets and languages it is listed in (the sitemap's views); the market asked is one even when the term has no live product there.
  const indexed = (await listIndexedTerms(store.id)).find((x) => x.kind === kind && x.slug === term.slug);
  const markets = store.markets.filter((m) => m.code === market.code || (indexed?.markets.includes(m.code) ?? false));
  const views = markets.flatMap((m) =>
    languageChoices(store.localization, m).map((locale) => ({ key: `${locale.split("-")[0]}-${m.code}`, href: path(inView(m, { locale, currency: m.nativeCurrency })) })),
  );
  return {
    title: typeof ownTitle === "string" ? term.name : ownTitle,
    description,
    alternates: {
      canonical: path(market),
      languages: {
        ...Object.fromEntries(views.map((v) => [v.key, v.href])),
        ...(views.length > 1 ? { "x-default": views[0].href } : {}),
      },
    },
    ...storeShareTags(store, market, {
      title: share.title,
      description: share.description,
      url: path(market),
      images: [storeShareImage(store, market.locale)],
    }),
  };
}

/**
 * A category or tag that is not there: an old address of one that was renamed goes to its current address for good, and anything else is the store's 404
 * (wave 2, D168). Only a store and market that exist are asked; the lookup is `missOrRedirect()`, never a database read of its own here.
 */
async function missed(kind: TermKind, params: Params): Promise<never> {
  const { store: storeSlug, market: marketSlug, slug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  // A country, language or currency the store no longer offers moves to one it does (D178).
  if (!shop) return marketMoved(storeSlug, marketSlug, `/${kind}/${slug}`);
  return missOrRedirect(shop, `/${kind}/${slug}`);
}

/**
 * The term's page: the store's page for its category pages or tag pages where one is chosen (D140: the Category products
 * component draws the listing, so a content grid that recommends can sit around it), else the standard listing.
 */
export async function TermProducts({ kind, params, searchParams }: { kind: TermKind; params: Params; searchParams: SearchParams }) {
  const loaded = await load(kind, params);
  if (!loaded) return missed(kind, params);
  const { store, market, term } = loaded;
  return (
    <RolePage store={store} market={market} role={kind} route={{ part: kind, param: term.slug, query: searchParams }} place={{ term: { id: term.id, kind } }}>
      <TermListing store={store} market={market} kind={kind} slug={term.slug} query={searchParams} />
    </RolePage>
  );
}

/**
 * The term's products: prerendered as the page's own list, then sorted and
 * filtered as the address asks (D78), per request. The standard category and
 * tag page, and the component a page built for them draws.
 */
export async function TermListing({ store, market, kind, slug, query }: { store: Store; market: Market; kind: TermKind; slug: string; query: Promise<StoreQuery> }) {
  const terms = await siteTerms(store.id, "product");
  const term = terms.find((t) => t.kind === kind && t.slug === slug);
  if (!term) return null;
  const m = t(market.lang);
  const scope = {
    categoryIds: kind === "category" ? withDescendants(terms, [term.id]) : [],
    tagIds: kind === "tag" ? [term.id] : [],
  };
  const [products, notices, fields] = await Promise.all([
    listGridProducts(store.id, market, { ...scope, sort: "oldest", limit: 48 }),
    campaignNotices(store.id, market),
    // The category's or tag's own public custom fields (D118), under its name.
    shownFieldsFor(store.id, "term", term.id, market.locale, market.lang, market.slug),
  ]);
  const termFields = groupsToShow(fields);
  const subcategories = kind === "category" ? terms.filter((t) => t.parentId === term.id).sort(byName) : [];
  const base = marketPath(store.slug, market.slug);

  return (
    <>
      <h1 className="mb-4 text-3xl font-heading tracking-tight">{term.name}</h1>
      {termFields.length > 0 && (
        <div className="mb-6">
          <CustomFieldGroups groups={termFields} showLabel idPrefix={`term-${term.id}`} headingFor={() => null} />
        </div>
      )}
      {subcategories.length > 0 && (
        <nav aria-label={term.name} className="mb-6">
          <ul className="flex flex-wrap gap-2">
            {subcategories.map((sub) => (
              <li key={sub.id}>
                <Link
                  href={`${base}/category/${sub.slug}`}
                  className="inline-flex min-h-10 items-center rounded-button border border-border px-4 text-sm hover:bg-surface"
                >
                  {sub.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <Suspense
        fallback={
          products.length === 0 ? <p>{m.noProducts}</p> : <ProductGrid products={products} market={market} m={m} store={store.slug} base={base} notices={notices} />
        }
      >
        <ProductListingFor
          store={store}
          market={market}
          scope={scope}
          searchParams={query}
          base={base}
          path={`${base}/${kind}/${term.slug}`}
        />
      </Suspense>
    </>
  );
}
