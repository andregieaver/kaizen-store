import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { AbMarker } from "@/components/ab/ab-marker";
import { JsonLdScript } from "@/components/json-ld";
import { PageEditLink } from "@/components/page-edit-link";
import { StorePageArticle } from "@/components/store-page-article";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { pageExcerpt, pageSlugProblem, RESERVED_STORE_PAGE_SLUGS } from "@/lib/page-content";
import { PAGE_ROLES, roleAddress } from "@/lib/page-roles";
import { localizePage } from "@/lib/page-translation";
import { adminOrigin, marketPath, storeSiteUrl } from "@/lib/paths";
import { pageJsonLd } from "@/lib/structured-data";
import { experimentOfPage } from "@/server/experiments";
import { findPublishedPage, type PublishedPage } from "@/server/pages";
import { missOrRedirect } from "@/server/redirect-resolve";
import { storeFacts, storeShareImage, storeShareTags } from "@/server/seo";
import { marketMoved, resolveShop } from "@/server/shop";

export type StorePageParams = Promise<{ store: string; market: string; slug: string }>;
export type StorePageQuery = Promise<Record<string, string | string[] | undefined>>;

export async function loadStorePage(params: StorePageParams) {
  const { store: storeSlug, market: marketSlug, slug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || pageSlugProblem(slug, RESERVED_STORE_PAGE_SLUGS) !== null) return null;
  const found = await findPublishedPage(shop.store.id, slug);
  return found ? { ...shop, found } : null;
}

export type Marker = { experiment: string; variant: string; goalBlock: string | null };

/**
 * The content to show for a page under a running A/B test (D148), and the marker that tells the browser which version it
 * is. The original (and anything unknown, or a version whose test has stopped) shows the page's own content; a version
 * shows the copy made for it.
 */
async function versionOf(storeId: string, page: PublishedPage, variant: string | null): Promise<{ content: PublishedPage["content"]; marker: Marker | null }> {
  const test = await experimentOfPage(storeId, page.id);
  if (!test) return { content: page.content, marker: null };
  if (variant && variant !== "a") {
    const slug = test.variants.find((v) => v.key === variant)?.slug;
    const copy = slug ? await findPublishedPage(storeId, slug, "variant") : null;
    if (copy && "page" in copy) return { content: copy.page.content, marker: { experiment: test.id, variant, goalBlock: test.goalBlock } };
    return { content: page.content, marker: null };
  }
  return { content: page.content, marker: { experiment: test.id, variant: "a", goalBlock: test.goalBlock } };
}

/**
 * The page's search and sharing details. A version of a page made for an A/B test (D148) is the same page for them:
 * its address is the original's, it is never indexed, and it names the original as its canonical address.
 */
export async function storePageMetadata(params: StorePageParams, variant: string | null): Promise<Metadata> {
  const loaded = await loadStorePage(params);
  if (!loaded || "redirect" in loaded.found) return {};
  const { store, market } = loaded;
  const { page } = loaded.found;
  // In the market's language where the page is translated (D55), as the version shows it (D148).
  const c = localizePage((await versionOf(store.id, page, variant)).content, market.locale);
  const title = c.seo.title || c.title;
  const description =
    c.seo.description || pageExcerpt(c) || store.seo.description[market.locale] || t(market.lang).storeSummary(store.name, market.name);
  const path = (m: Market) => marketPath(store.slug, m.slug, `/${page.slug}`);
  return {
    // The page's own search title is used as written; otherwise "Title · Store".
    title: c.seo.title ? { absolute: c.seo.title } : c.title,
    description,
    alternates: {
      canonical: path(market),
      languages: Object.fromEntries(store.markets.map((m) => [m.locale, path(m)])),
    },
    ...(!c.searchEngines || variant ? { robots: { index: false } } : {}),
    ...storeShareTags(store, market, {
      title,
      description,
      url: path(market),
      images: c.thumbnail
        ? [{ url: c.thumbnail.url, alt: c.thumbnail.alt || c.title, width: c.thumbnail.width, height: c.thumbnail.height }]
        : [storeShareImage(store, market.locale)],
    }),
  };
}

/**
 * A store's page, or, with `variant`, the version of it an A/B test shows (D148). A test that is not running (it stopped
 * after the visitor was sent here) leaves the original. A page under a running test carries a marker that tells the
 * browser which version this is.
 */
export async function StorePageView({ params, searchParams, variant }: { params: StorePageParams; searchParams: StorePageQuery; variant: string | null }) {
  const loaded = await loadStorePage(params);
  if (!loaded) {
    // A manual redirect's source, or the old address of a product that was moved here, goes on for good; anything else is the store's 404 (wave 2, D168).
    const { store: storeSlug, market: marketSlug, slug } = await params;
    const shop = await resolveShop(storeSlug, marketSlug);
    // A country, language or currency the store no longer offers moves to one it does (D178).
    if (!shop) return marketMoved(storeSlug, marketSlug, `/${slug}`);
    return missOrRedirect(shop, `/${slug}`);
  }
  const { store, market, found } = loaded;
  const home = marketPath(store.slug, market.slug);
  // A page that moved: its old address leads to the new one for good.
  if ("redirect" in found) permanentRedirect(`${home}/${found.redirect}`);
  const { page } = found;
  // The front page (D54) has one address: the market's own.
  if (page.id === store.frontPageId) permanentRedirect(home);
  // So has the All products page (D83): /products.
  if (page.id === store.productsPageId) permanentRedirect(`${home}/products`);
  // So have the pages chosen for the blog, search and 404 places (D112).
  // A working page (D113) too: its address is its route's, or none (an order's, a subscription's, the 404 page's).
  const role = PAGE_ROLES.find((r) => page.id === store.pageRoles[r]);
  if (role) {
    const address = roleAddress(role, home);
    if (address) permanentRedirect(address);
    notFound();
  }
  // A page under a running A/B test (D148): which version this is, and for a version the page that holds it.
  const { content, marker } = await versionOf(store.id, page, variant);
  const c = localizePage(content, market.locale);
  const origin = storeSiteUrl(store.slug);

  return (
    <>
      <JsonLdScript
        data={pageJsonLd({
          origin,
          url: `${origin}${home}/${page.slug}`,
          title: c.title,
          description: c.seo.description || pageExcerpt(c),
          image: c.thumbnail?.url ?? null,
          publishedAt: page.publishedAt,
          store: { homeUrl: `${origin}${home}`, storeUrl: storeFacts(store).url, locale: market.locale },
        })}
      />
      <StorePageArticle
        content={c}
        place={{ pageId: page.id, owner: store.id, market: market.slug, listing: { query: searchParams, path: `${home}/${page.slug}` } }}
      />
      <PageEditLink pageId={page.id} store={store.slug} adminOrigin={adminOrigin(store.slug)} />
      {marker && <AbMarker storeId={store.id} store={store.slug} market={market.slug} experiment={marker.experiment} variant={marker.variant} goalBlock={marker.goalBlock} />}
    </>
  );
}
