import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContentGridView } from "@/components/content-grid";
import { PartStyles } from "@/components/part-styles";
import { PageEditLink } from "@/components/page-edit-link";
import { StorePageArticle } from "@/components/store-page-article";
import { browserText } from "@/lib/browser-text";
import { blogPath, blogTitle, feedPath, type Blog } from "@/lib/blogs";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { ContentGridBlock } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";
import { localizePage } from "@/lib/page-translation";
import { adminOrigin, marketPath } from "@/lib/paths";
import { byName, type Term, type TermKind } from "@/lib/taxonomy";
import { blogArticles, findBlog, storeBlogs } from "@/server/blogs";
import { gridData } from "@/server/content-grid";
import { listPublishedPages, pageForRole, type PublishedPage } from "@/server/pages";
import { missOrRedirect } from "@/server/redirect-resolve";
import { marketMoved, resolveShop } from "@/server/shop";
import type { Store } from "@/server/stores";
import { siteTerms } from "@/server/taxonomy";

/**
 * A store's blogs (D57, D341): a blog's articles newest first at its address (`/blog` for the first, `/blogs/{handle}` for the others),
 * and those in one category (with its subcategories) or with one tag at `{blog}/category/[slug]` and `{blog}/tag/[slug]`, in the market's
 * language. A blog lists the categories its own articles are in; its page head links its Atom feed (`{blog}/feed.atom`).
 */

type ShopParams = Promise<{ store: string; market: string }>;
type Params = Promise<{ store: string; market: string; slug: string }>;

const pathIn = (store: Pick<Store, "slug">, marketSlug: string, path: string) => marketPath(store.slug, marketSlug, path);

/** A grid of one blog's articles, one to three to a row. */
function listing(key: string, blog: Pick<Blog, "id">, filter: { categories?: string[]; tags?: string[] } = {}): ContentGridBlock {
  const grid = newBlock("contentGrid", () => `blog-${key}`) as ContentGridBlock;
  return {
    ...grid,
    source: { type: "articles", blog: blog.id },
    categories: filter.categories ?? [],
    tags: filter.tags ?? [],
    limit: 48,
    show: { ...grid.show, button: false },
  };
}

function CategoryLinks({ label, terms, href }: { label: string; terms: Term[]; href: (slug: string) => string }) {
  if (terms.length === 0) return null;
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {terms.map((term) => (
          <li key={term.id}>
            <Link
              href={href(term.slug)}
              className="inline-flex min-h-10 items-center rounded-button border border-border px-4 text-sm hover:bg-surface"
            >
              {term.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The blog's Atom feed as the page head's `alternate` link (`<link rel="alternate" type="application/atom+xml">`). */
export function feedAlternate(store: Pick<Store, "slug">, market: Pick<Market, "slug">, blog: Blog, title: string): NonNullable<Metadata["alternates"]>["types"] {
  return { "application/atom+xml": [{ url: pathIn(store, market.slug, feedPath(blog)), title }] };
}

/** The blog an address names (the first for `handle` null), with the shop; null when the store, market or blog is not there. */
async function loadBlog(params: ShopParams, handle: string | null) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return null;
  const blog = await findBlog(shop.store.id, handle);
  return blog ? { ...shop, blog } : null;
}

/** The page chosen to stand at a blog's address: the first blog's is the `blog` place (D112), another's its own listing page. */
async function listingPage(store: Store, blog: Blog): Promise<PublishedPage | null> {
  if (blog.main) return pageForRole(store, "blog");
  if (!blog.listingPageId) return null;
  return (await listPublishedPages(store.id)).find((page) => page.id === blog.listingPageId) ?? null;
}

export async function blogMetadata(params: ShopParams, handle: string | null = null): Promise<Metadata> {
  const loaded = await loadBlog(params, handle);
  if (!loaded) return {};
  const { store, market, blog } = loaded;
  const m = t(market.lang);
  const name = blogTitle(blog, market.locale, store.localization.locales[0], m.blog);
  const alternates = { canonical: pathIn(store, market.slug, blogPath(blog)), types: feedAlternate(store, market, blog, name) };
  // The page chosen for the blog (D112) has its own title and search texts.
  const page = await listingPage(store, blog);
  if (!page) return { title: name, alternates };
  const c = localizePage(page.content, market.locale);
  return {
    title: c.seo.title || c.title,
    description: c.seo.description || undefined,
    alternates,
    ...(!c.searchEngines && { robots: { index: false } }),
  };
}

/** The categories a blog's own articles are in, with the ones above them: what its listing offers. */
async function blogCategories(storeId: string, blog: Blog, terms: Term[]): Promise<Term[]> {
  const used = new Set((await blogArticles(storeId, blog)).flatMap((article) => article.content.categories));
  for (const id of [...used]) {
    for (let term = terms.find((x) => x.id === id), depth = 0; term?.parentId && depth < 10; term = terms.find((x) => x.id === term!.parentId), depth++) {
      used.add(term.parentId);
    }
  }
  return terms.filter((term) => term.kind === "category" && used.has(term.id));
}

/** A blog: every published article of its own, newest first, with its top categories; or the page chosen to stand there. */
export async function StoreBlog({ params, handle = null }: { params: ShopParams; handle?: string | null }) {
  const loaded = await loadBlog(params, handle);
  if (!loaded) {
    const { store: storeSlug, market: marketSlug } = await params;
    const shop = await resolveShop(storeSlug, marketSlug);
    const path = handle === null ? "/blog" : `/blogs/${handle}`;
    // A country, language or currency the store no longer offers moves to one it does (D178).
    if (!shop) return marketMoved(storeSlug, marketSlug, path);
    return missOrRedirect(shop, path);
  }
  const { store, market, blog } = loaded;
  const page = await listingPage(store, blog);
  if (page) {
    return (
      <>
        <StorePageArticle
          content={localizePage(page.content, market.locale)}
          place={{ pageId: page.id, owner: store.id, market: market.slug }}
          editable={market.locale === store.localization.locales[0]}
        />
        <PageEditLink pageId={page.id} store={store.slug} adminOrigin={adminOrigin(store.slug)} textEditable={market.locale === store.localization.locales[0]} />
      </>
    );
  }
  const m = t(market.lang);
  const name = blogTitle(blog, market.locale, store.localization.locales[0], m.blog);
  const grid = listing(blog.main ? "index" : `index-${blog.handle}`, blog);
  const [data, terms] = await Promise.all([gridData(grid, { pageId: null, owner: store.id, market: market.slug }), siteTerms(store.id, "article")]);
  const top = (await blogCategories(store.id, blog, terms)).filter((term) => term.parentId === null).sort(byName);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-heading tracking-tight">{name}</h1>
        <a href={pathIn(store, market.slug, feedPath(blog))} className="text-sm underline" type="application/atom+xml">
          {browserText(market.lang).blogComments.feed}
        </a>
      </div>
      <CategoryLinks label={name} terms={top} href={(slug) => pathIn(store, market.slug, `${blogPath(blog)}/category/${slug}`)} />
      <PartStyles blocks={[grid]} owner={store.id} />
      <ContentGridView block={{ ...grid, emptyText: m.noArticles }} data={data} />
    </div>
  );
}

/** Prerender each article category or tag known at build time; later ones render on first visit. */
export async function blogTermStaticParams(kind: TermKind, params: { store: string; market: string }) {
  const shop = await resolveShop(params.store, params.market);
  const terms = shop ? (await siteTerms(shop.store.id, "article")).filter((t) => t.kind === kind) : [];
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return terms.length > 0 ? terms.map((term) => ({ slug: term.slug })) : [{ slug: "_" }];
}

/** The same for the store's other blogs (D341) at `/blogs/{handle}/{kind}/{slug}`: each term with each blog, as that route names both. */
export async function otherBlogTermParams(kind: TermKind, params: { store: string; market: string }) {
  const shop = await resolveShop(params.store, params.market);
  const blogs = shop ? (await storeBlogs(shop.store.id)).filter((blog) => !blog.main) : [];
  const terms = blogs.length > 0 ? (await siteTerms(shop!.store.id, "article")).filter((t) => t.kind === kind) : [];
  const pairs = blogs.flatMap((blog) => terms.map((term) => ({ blog: blog.handle, slug: term.slug })));
  return pairs.length > 0 ? pairs : [{ blog: "_", slug: "_" }];
}

/** Prerender each of the store's blogs but the first (at `/blogs/{handle}`); later ones render on first visit. */
export async function otherBlogsStaticParams(params: { store: string; market: string }) {
  const shop = await resolveShop(params.store, params.market);
  const blogs = shop ? (await storeBlogs(shop.store.id)).filter((blog) => !blog.main) : [];
  return blogs.length > 0 ? blogs.map((blog) => ({ blog: blog.handle })) : [{ blog: "_" }];
}

async function loadTerm(kind: TermKind, params: Params, handle: string | null) {
  const { store: storeSlug, market: marketSlug, slug } = await params;
  const loaded = await loadBlog(Promise.resolve({ store: storeSlug, market: marketSlug }), handle);
  if (!loaded) return null;
  const terms = await siteTerms(loaded.store.id, "article");
  const term = terms.find((t) => t.kind === kind && t.slug === slug);
  return term ? { ...loaded, terms, term } : null;
}

export async function blogTermMetadata(kind: TermKind, params: Params, handle: string | null = null): Promise<Metadata> {
  const loaded = await loadTerm(kind, params, handle);
  if (!loaded) return {};
  const { store, market, term, blog } = loaded;
  const name = blogTitle(blog, market.locale, store.localization.locales[0], t(market.lang).blog);
  return {
    title: term.name,
    alternates: { canonical: pathIn(store, market.slug, `${blogPath(blog)}/${kind}/${term.slug}`), types: feedAlternate(store, market, blog, name) },
  };
}

export async function StoreBlogTerm({ kind, params, handle = null }: { kind: TermKind; params: Params; handle?: string | null }) {
  const loaded = await loadTerm(kind, params, handle);
  if (!loaded) {
    // A country, language or currency the store no longer offers moves to one it does (D178).
    const { store: storeSlug, market: marketSlug, slug } = await params;
    const path = `${handle === null ? "/blog" : `/blogs/${handle}`}/${kind}/${slug}`;
    const shop = await resolveShop(storeSlug, marketSlug);
    if (!shop) return marketMoved(storeSlug, marketSlug, path);
    if (handle === null) notFound();
    return missOrRedirect(shop, path);
  }
  const { store, market, terms, term, blog } = loaded;
  const m = t(market.lang);
  const name = blogTitle(blog, market.locale, store.localization.locales[0], m.blog);
  const grid = listing(`${blog.handle}-${term.id}`, blog, kind === "category" ? { categories: [term.id] } : { tags: [term.id] });
  const data = await gridData(grid, { pageId: null, owner: store.id, market: market.slug });
  const own = new Set((await blogCategories(store.id, blog, terms)).map((x) => x.id));
  const subcategories = kind === "category" ? terms.filter((t) => t.parentId === term.id && own.has(t.id)).sort(byName) : [];
  return (
    <div className="flex flex-col gap-6">
      <Link href={pathIn(store, market.slug, blogPath(blog))} className="w-fit text-sm underline">
        {name}
      </Link>
      <h1 className="text-3xl font-heading tracking-tight">{term.name}</h1>
      <CategoryLinks label={term.name} terms={subcategories} href={(slug) => pathIn(store, market.slug, `${blogPath(blog)}/category/${slug}`)} />
      <PartStyles blocks={[grid]} owner={store.id} />
      <ContentGridView block={{ ...grid, emptyText: m.noArticles }} data={data} />
    </div>
  );
}
