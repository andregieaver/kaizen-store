import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { ArticleView } from "@/components/article-view";
import { BlogComments } from "@/components/blog-comments";
import { JsonLdScript } from "@/components/json-ld";
import { PageEditLink } from "@/components/page-edit-link";
import { articlePath, blogOfArticle, blogPath, blogTitle, inBlog, type Blog } from "@/lib/blogs";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { pageExcerpt, pageSlugProblem, reservedPageSlugs } from "@/lib/page-content";
import { pageInMarket } from "@/lib/page-markets";
import { localizePage } from "@/lib/page-translation";
import { adminOrigin, marketMetaPath, marketPath, marketUrl, storeSiteUrl } from "@/lib/paths";
import { articleJsonLd } from "@/lib/structured-data";
import { approvedComments } from "@/server/blog-comments";
import { authorOf, bylineOf, findBlog, storeAuthors, storeBlogs } from "@/server/blogs";
import { bindForPlace } from "@/server/field-binding";
import { findPublishedPage, listPublishedPages } from "@/server/pages";
import { missOrRedirect } from "@/server/redirect-resolve";
import { storeFacts, storeShareImage, storeShareTags } from "@/server/seo";
import { marketMoved, resolveShop } from "@/server/shop";

import { feedAlternate } from "./blog-listing";

/**
 * A store's articles (D57) in their blogs (D341): `/blog/{slug}` for the first blog's, `/blogs/{handle}/{slug}` for another's, in each of
 * its markets and languages (D55). An article asked for under another blog's address moves there for good, so an article moved between
 * blogs keeps every old link working. Prerendered when the site is built; later ones render on first visit and are then cached until the
 * next change. Approved comments are read cached under the store's comments tag.
 */

type ArticleParams = Promise<{ store: string; market: string; slug: string }>;

/** The articles of one blog (the first for `handle` null), to prerender. */
export async function articleStaticParams(params: { store: string; market: string }, handle: string | null) {
  const shop = await resolveShop(params.store, params.market);
  const blog = shop ? await findBlog(shop.store.id, handle) : null;
  const [blogs, articles] = shop && blog ? await Promise.all([storeBlogs(shop.store.id), listPublishedPages(shop.store.id, "article")]) : [[], []];
  const own = blog ? articles.filter((article) => inBlog(blogs, blog, article.content)) : [];
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return own.length > 0 ? own.map((article) => ({ slug: article.slug })) : [{ slug: "_" }];
}

/**
 * The articles of the store's other blogs (D341) at `/blogs/{handle}/{slug}`, each with its blog: the route has no layout of its own for the
 * blog, so it names both, or the build would meet a blog it does not know and could not prerender the page.
 */
export async function otherBlogArticleParams(params: { store: string; market: string }) {
  const shop = await resolveShop(params.store, params.market);
  const blogs = shop ? await storeBlogs(shop.store.id) : [];
  const articles = shop && blogs.some((blog) => !blog.main) ? await listPublishedPages(shop.store.id, "article") : [];
  const pairs = blogs
    .filter((blog) => !blog.main)
    .flatMap((blog) => articles.filter((article) => inBlog(blogs, blog, article.content)).map((article) => ({ blog: blog.handle, slug: article.slug })));
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return pairs.length > 0 ? pairs : [{ blog: "_", slug: "_" }];
}

async function load(params: ArticleParams, handle: string | null) {
  const { store: storeSlug, market: marketSlug, slug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || pageSlugProblem(slug, reservedPageSlugs(shop.store.id, "article")) !== null) return null;
  const route = await findBlog(shop.store.id, handle);
  if (!route) return null;
  const found = await findPublishedPage(shop.store.id, slug, "article");
  if (!found) return null;
  if ("redirect" in found) return { ...shop, route, found, blog: route };
  // An article for other countries only (D338) is not here: the route's 404, or a manual redirect.
  if (!pageInMarket(found.page.content, shop.market.code)) return null;
  const blog = blogOfArticle(await storeBlogs(shop.store.id), found.page.content) ?? route;
  return { ...shop, route, found, blog };
}

export async function articleMetadata(params: ArticleParams, handle: string | null): Promise<Metadata> {
  const loaded = await load(params, handle);
  if (!loaded || "redirect" in loaded.found || !loaded.blog || loaded.blog.id !== loaded.route.id) return {};
  const { store, market, blog } = loaded;
  const { page } = loaded.found;
  const c = localizePage(page.content, market.locale);
  const author = authorOf(await storeAuthors(store.id), c);
  const title = c.seo.title || c.title;
  const description =
    c.seo.description || pageExcerpt(c) || store.seo.description[market.locale] || t(market.lang).storeSummary(store.name, market.name);
  const path = (m: Market) => marketMetaPath(store.slug, m.slug, articlePath(blog, page.slug));
  const share = storeShareTags(store, market, {
    title,
    description,
    url: path(market),
    images: c.thumbnail
      ? [{ url: c.thumbnail.url, alt: c.thumbnail.alt || c.title, width: c.thumbnail.width, height: c.thumbnail.height }]
      : [storeShareImage(store, market.locale)],
  });
  const byline = author?.name || c.author;
  return {
    // The article's own search title is used as written; otherwise "Title · Store".
    title: c.seo.title ? { absolute: c.seo.title } : c.title,
    description,
    alternates: {
      canonical: path(market),
      languages: Object.fromEntries(store.markets.filter((m) => pageInMarket(page.content, m.code)).map((m) => [m.locale, path(m)])),
      types: feedAlternate(store, market, blog, blogTitle(blog, market.locale, store.localization.locales[0], t(market.lang).blog)),
    },
    ...(!c.searchEngines && { robots: { index: false } }),
    ...share,
    openGraph: {
      ...share.openGraph,
      type: "article",
      publishedTime: page.firstPublishedAt,
      modifiedTime: page.publishedAt,
      ...(byline && { authors: [byline] }),
    },
  };
}

export async function StoreArticle({ params, handle }: { params: ArticleParams; handle: string | null }) {
  const loaded = await load(params, handle);
  const { store: storeSlug, market: marketSlug, slug } = await params;
  const here = (blog: Pick<Blog, "main" | "handle"> | null) => (blog ? blogPath(blog) : handle === null ? "/blog" : `/blogs/${handle}`);
  if (!loaded) {
    // An address that was an article's, or a manual redirect's source, goes on for good; anything else is the store's 404 (wave 2, D168).
    const shop = await resolveShop(storeSlug, marketSlug);
    // A country, language or currency the store no longer offers moves to one it does (D178).
    if (!shop) return marketMoved(storeSlug, marketSlug, `${here(null)}/${slug}`);
    return missOrRedirect(shop, `${here(null)}/${slug}`);
  }
  const { store, market, found, route } = loaded;
  // An article that moved: its old address leads to the new one for good (and on to its blog, if that is another).
  if ("redirect" in found) permanentRedirect(marketPath(store.slug, market.slug, `${blogPath(route)}/${found.redirect}`));
  const blog = loaded.blog ?? route;
  // An article of another blog: its own blog's address is where it lives (D341).
  if (blog.id !== route.id) permanentRedirect(marketPath(store.slug, market.slug, articlePath(blog, found.page.slug)));
  const { page } = found;
  const place = { pageId: page.id, owner: store.id, market: market.slug, pageType: "article" as const };
  // Blocks bound to the article's custom fields (D118) show their values.
  const c = await bindForPlace(localizePage(page.content, market.locale), place);
  const [authors, comments] = await Promise.all([storeAuthors(store.id), blog.comments === "off" ? Promise.resolve([]) : approvedComments(store.id, page.id)]);
  const author = authorOf(authors, c);
  const origin = storeSiteUrl(store.slug);

  return (
    // Spans the window like a store's page (D54); its rows keep to the width themselves.
    <div className="store-page py-8">
      <JsonLdScript
        data={articleJsonLd({
          origin,
          url: marketUrl(store.slug, market.slug, articlePath(blog, page.slug)),
          title: c.title,
          description: c.seo.description || pageExcerpt(c),
          image: c.thumbnail?.url ?? null,
          publishedAt: page.firstPublishedAt,
          modifiedAt: page.publishedAt,
          author: author ? { name: author.name, url: author.link, image: author.picture, description: author.bio || null } : c.author || null,
          locale: market.locale,
          store: { homeUrl: marketUrl(store.slug, market.slug), storeUrl: storeFacts(store).url },
        })}
      />
      <ArticleView
        content={c}
        date={page.firstPublishedAt}
        byline={bylineOf(author, c, store.name)}
        lang={market.lang}
        locale={market.locale}
        place={place}
        editable={market.locale === store.localization.locales[0]}
        author={author}
      />
      <BlogComments setting={blog.comments} comments={comments} store={store.slug} market={market.slug} article={page.id} lang={market.lang} locale={market.locale} />
      <PageEditLink pageId={page.id} store={store.slug} article adminOrigin={adminOrigin(store.slug)} textEditable={market.locale === store.localization.locales[0]} />
    </div>
  );
}
