import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { ArticleView } from "@/components/article-view";
import { JsonLdScript } from "@/components/json-ld";
import { PageEditLink } from "@/components/page-edit-link";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { pageExcerpt, pageSlugProblem, reservedPageSlugs } from "@/lib/page-content";
import { localizePage } from "@/lib/page-translation";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { articleJsonLd } from "@/lib/structured-data";
import { findPublishedPage, listPublishedPages } from "@/server/pages";
import { storeFacts, storeShareImage, storeShareTags } from "@/server/seo";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/blog/[slug]">;

/**
 * A store's articles (D57), in each of its markets and its languages (D55),
 * prerendered when the site is built; later ones render on first visit and
 * are then cached until the next change.
 */
export async function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  const shop = await resolveShop(params.store, params.market);
  const articles = shop ? await listPublishedPages(shop.store.id, "article") : [];
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return articles.length > 0 ? articles.map((article) => ({ slug: article.slug })) : [{ slug: "_" }];
}

async function load(params: Props["params"]) {
  const { store: storeSlug, market: marketSlug, slug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || pageSlugProblem(slug, reservedPageSlugs(shop.store.id, "article")) !== null) return null;
  const found = await findPublishedPage(shop.store.id, slug, "article");
  return found ? { ...shop, found } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded || "redirect" in loaded.found) return {};
  const { store, market } = loaded;
  const { page } = loaded.found;
  const c = localizePage(page.content, market.locale);
  const title = c.seo.title || c.title;
  const description =
    c.seo.description || pageExcerpt(c) || store.seo.description[market.locale] || t(market.lang).storeSummary(store.name, market.name);
  const path = (m: Market) => marketPath(store.slug, m.slug, `/blog/${page.slug}`);
  const share = storeShareTags(store, market, {
    title,
    description,
    url: path(market),
    images: c.thumbnail
      ? [{ url: c.thumbnail.url, alt: c.thumbnail.alt || c.title, width: c.thumbnail.width, height: c.thumbnail.height }]
      : [storeShareImage(store, market.locale)],
  });
  return {
    // The article's own search title is used as written; otherwise "Title · Store".
    title: c.seo.title ? { absolute: c.seo.title } : c.title,
    description,
    alternates: {
      canonical: path(market),
      languages: Object.fromEntries(store.markets.map((m) => [m.locale, path(m)])),
    },
    ...(!c.searchEngines && { robots: { index: false } }),
    ...share,
    openGraph: {
      ...share.openGraph,
      type: "article",
      publishedTime: page.firstPublishedAt,
      modifiedTime: page.publishedAt,
      ...(c.author && { authors: [c.author] }),
    },
  };
}

export default async function StoreArticlePage({ params }: Props) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { store, market, found } = loaded;
  const blog = marketPath(store.slug, market.slug, "/blog");
  // An article that moved: its old address leads to the new one for good.
  if ("redirect" in found) permanentRedirect(`${blog}/${found.redirect}`);
  const { page } = found;
  const c = localizePage(page.content, market.locale);
  const origin = storeSiteUrl(store.slug);

  return (
    // Spans the window like a store's page (D54); its rows keep to the width themselves.
    <div className="store-page py-8">
      <JsonLdScript
        data={articleJsonLd({
          origin,
          url: `${origin}${blog}/${page.slug}`,
          title: c.title,
          description: c.seo.description || pageExcerpt(c),
          image: c.thumbnail?.url ?? null,
          publishedAt: page.firstPublishedAt,
          modifiedAt: page.publishedAt,
          author: c.author || null,
          locale: market.locale,
          store: { homeUrl: `${origin}${marketPath(store.slug, market.slug)}`, storeUrl: storeFacts(store).url },
        })}
      />
      <ArticleView
        content={c}
        date={page.firstPublishedAt}
        byline={c.author || store.name}
        lang={market.lang}
        locale={market.locale}
        place={{ pageId: page.id, owner: store.id, market: market.code }}
      />
      <PageEditLink pageId={page.id} store={store.slug} article />
    </div>
  );
}
