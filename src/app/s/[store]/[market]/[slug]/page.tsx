import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { JsonLdScript } from "@/components/json-ld";
import { PageEditLink } from "@/components/page-edit-link";
import { StorePageArticle } from "@/components/store-page-article";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { pageExcerpt, pageSlugProblem, RESERVED_STORE_PAGE_SLUGS } from "@/lib/page-content";
import { localizePage } from "@/lib/page-translation";
import { adminOrigin, marketPath, storeSiteUrl } from "@/lib/paths";
import { pageJsonLd } from "@/lib/structured-data";
import { findPublishedPage, listPublishedPages } from "@/server/pages";
import { storeFacts, storeShareImage, storeShareTags } from "@/server/seo";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/[slug]">;

/**
 * A store's own pages (D54), in each of its markets, prerendered when the
 * site is built so their content is plain HTML; pages published later are
 * rendered on first visit and then cached until the next change. The
 * store's own routes (`/p`, `/cart`, …) come first, and pages cannot take
 * their addresses (D53).
 */
export async function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  const shop = await resolveShop(params.store, params.market);
  const pages = shop ? await listPublishedPages(shop.store.id) : [];
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return pages.length > 0 ? pages.map((page) => ({ slug: page.slug })) : [{ slug: "_" }];
}

async function load(params: Props["params"]) {
  const { store: storeSlug, market: marketSlug, slug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || pageSlugProblem(slug, RESERVED_STORE_PAGE_SLUGS) !== null) return null;
  const found = await findPublishedPage(shop.store.id, slug);
  return found ? { ...shop, found } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded || "redirect" in loaded.found) return {};
  const { store, market } = loaded;
  const { page } = loaded.found;
  // In the market's language where the page is translated (D55).
  const c = localizePage(page.content, market.locale);
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
    ...(!c.searchEngines && { robots: { index: false } }),
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

export default async function StorePage({ params }: Props) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { store, market, found } = loaded;
  const home = marketPath(store.slug, market.slug);
  // A page that moved: its old address leads to the new one for good.
  if ("redirect" in found) permanentRedirect(`${home}/${found.redirect}`);
  const { page } = found;
  // The front page (D54) has one address: the market's own.
  if (page.id === store.frontPageId) permanentRedirect(home);
  const c = localizePage(page.content, market.locale);
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
      <StorePageArticle content={c} place={{ pageId: page.id, owner: store.id, market: market.code }} />
      <PageEditLink pageId={page.id} store={store.slug} adminOrigin={adminOrigin(store.slug)} />
    </>
  );
}
