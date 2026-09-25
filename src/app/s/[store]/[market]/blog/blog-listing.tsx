import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContentGridView } from "@/components/content-grid";
import { t } from "@/lib/i18n";
import type { ContentGridBlock } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";
import { marketPath } from "@/lib/paths";
import { byName, type Term, type TermKind } from "@/lib/taxonomy";
import { gridData } from "@/server/content-grid";
import { resolveShop } from "@/server/shop";
import type { Store } from "@/server/stores";
import { siteTerms } from "@/server/taxonomy";

/**
 * A store's blog (D57): its articles newest first at `/blog`, and those in
 * one category (with its subcategories) or with one tag at
 * `/blog/category/[slug]` and `/blog/tag/[slug]`, in the market's language.
 */

type ShopParams = Promise<{ store: string; market: string }>;
type Params = Promise<{ store: string; market: string; slug: string }>;

const blogPath = (store: Pick<Store, "slug">, marketSlug: string, rest = "") => marketPath(store.slug, marketSlug, `/blog${rest}`);

/** A grid of the store's articles, one to three to a row. */
function listing(key: string, filter: { categories?: string[]; tags?: string[] } = {}): ContentGridBlock {
  const grid = newBlock("contentGrid", () => `blog-${key}`) as ContentGridBlock;
  return {
    ...grid,
    source: { type: "articles" },
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
              className="inline-flex min-h-10 items-center rounded-full border border-border px-4 text-sm hover:bg-surface"
            >
              {term.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export async function blogMetadata(params: ShopParams): Promise<Metadata> {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return {};
  const m = t(shop.market.lang);
  return { title: m.blog, alternates: { canonical: blogPath(shop.store, shop.market.slug) } };
}

/** The store's blog: every published article, newest first, with its top categories. */
export async function StoreBlog({ params }: { params: ShopParams }) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);
  const grid = listing("index");
  const [data, terms] = await Promise.all([
    gridData(grid, { pageId: null, owner: store.id, market: market.code }),
    siteTerms(store.id, "article"),
  ]);
  const top = terms.filter((t) => t.kind === "category" && t.parentId === null).sort(byName);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">{m.blog}</h1>
      <CategoryLinks label={m.blog} terms={top} href={(slug) => blogPath(store, market.slug, `/category/${slug}`)} />
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

async function loadTerm(kind: TermKind, params: Params) {
  const { store: storeSlug, market: marketSlug, slug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return null;
  const terms = await siteTerms(shop.store.id, "article");
  const term = terms.find((t) => t.kind === kind && t.slug === slug);
  return term ? { ...shop, terms, term } : null;
}

export async function blogTermMetadata(kind: TermKind, params: Params): Promise<Metadata> {
  const loaded = await loadTerm(kind, params);
  if (!loaded) return {};
  const { store, market, term } = loaded;
  return { title: term.name, alternates: { canonical: blogPath(store, market.slug, `/${kind}/${term.slug}`) } };
}

export async function StoreBlogTerm({ kind, params }: { kind: TermKind; params: Params }) {
  const loaded = await loadTerm(kind, params);
  if (!loaded) notFound();
  const { store, market, terms, term } = loaded;
  const m = t(market.lang);
  const grid = listing(term.id, kind === "category" ? { categories: [term.id] } : { tags: [term.id] });
  const data = await gridData(grid, { pageId: null, owner: store.id, market: market.code });
  const subcategories = kind === "category" ? terms.filter((t) => t.parentId === term.id).sort(byName) : [];
  return (
    <div className="flex flex-col gap-6">
      <Link href={blogPath(store, market.slug)} className="w-fit text-sm underline">
        {m.blog}
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">{term.name}</h1>
      <CategoryLinks label={term.name} terms={subcategories} href={(slug) => blogPath(store, market.slug, `/category/${slug}`)} />
      <ContentGridView block={{ ...grid, emptyText: m.noArticles }} data={data} />
    </div>
  );
}
