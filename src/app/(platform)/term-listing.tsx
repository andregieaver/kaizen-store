import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContentGridView } from "@/components/content-grid";
import type { ContentGridBlock, PageType } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";
import { byName, type Term, type TermKind } from "@/lib/taxonomy";
import { gridData } from "@/server/content-grid";
import { siteTerms } from "@/server/taxonomy";

/**
 * Kaizen's published pages in one category (with its subcategories) or
 * with one tag (D50), as a content grid: where the menus' category and tag
 * links lead. Shared by `/category/[slug]` and `/tag/[slug]`, and for the
 * blog (D57) by `/blog`, `/blog/category/[slug]` and `/blog/tag/[slug]`.
 */

type Params = Promise<{ slug: string }>;

const base = (type: PageType) => (type === "article" ? "/blog" : "");

export async function termStaticParams(kind: TermKind, type: PageType = "page") {
  const terms = (await siteTerms(null, type)).filter((t) => t.kind === kind);
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return terms.length > 0 ? terms.map((term) => ({ slug: term.slug })) : [{ slug: "_" }];
}

async function load(kind: TermKind, params: Params, type: PageType) {
  const { slug } = await params;
  const terms = await siteTerms(null, type);
  const term = terms.find((t) => t.kind === kind && t.slug === slug);
  return term ? { terms, term } : null;
}

export async function termMetadata(kind: TermKind, params: Params, type: PageType = "page"): Promise<Metadata> {
  const loaded = await load(kind, params, type);
  if (!loaded) return {};
  return { title: loaded.term.name, alternates: { canonical: `${base(type)}/${kind}/${loaded.term.slug}` } };
}

/** A grid of Kaizen's pages or articles; articles newest first, one or three to a row. */
function listing(type: PageType, key: string, filter: { categories?: string[]; tags?: string[] } = {}): ContentGridBlock {
  const grid = newBlock("contentGrid", () => `listing-${key}`) as ContentGridBlock;
  return {
    ...grid,
    source: type === "article" ? { type: "articles" } : { type: "pages" },
    categories: filter.categories ?? [],
    tags: filter.tags ?? [],
    limit: 48,
    emptyText: type === "article" ? "No articles here yet." : "No pages here yet.",
    ...(type === "article" && { show: { ...grid.show, button: false } }),
  };
}

/** Links to categories: a category's subcategories, or the blog's top ones. */
function CategoryLinks({ label, terms, type }: { label: string; terms: Term[]; type: PageType }) {
  if (terms.length === 0) return null;
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {terms.map((term) => (
          <li key={term.id}>
            <Link
              href={`${base(type)}/category/${term.slug}`}
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

export async function TermPages({ kind, params, type = "page" }: { kind: TermKind; params: Params; type?: PageType }) {
  const loaded = await load(kind, params, type);
  if (!loaded) notFound();
  const { terms, term } = loaded;
  const grid = listing(type, term.id, kind === "category" ? { categories: [term.id] } : { tags: [term.id] });
  const data = await gridData(grid, { pageId: null, owner: null });
  const subcategories = kind === "category" ? terms.filter((t) => t.parentId === term.id).sort(byName) : [];

  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
      {type === "article" && (
        <Link href="/blog" className="w-fit text-sm underline">
          Blog
        </Link>
      )}
      <h1 className="text-3xl font-semibold tracking-tight">{term.name}</h1>
      <CategoryLinks label={term.name} terms={subcategories} type={type} />
      <ContentGridView block={grid} data={data} />
    </main>
  );
}

/** Kaizen's blog (D57): every published article, newest first, with its top categories. */
export async function BlogIndex() {
  const grid = listing("article", "blog");
  const [data, terms] = await Promise.all([gridData(grid, { pageId: null, owner: null }), siteTerms(null, "article")]);
  const top = terms.filter((t) => t.kind === "category" && t.parentId === null).sort(byName);
  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Blog</h1>
      <CategoryLinks label="Categories" terms={top} type="article" />
      <ContentGridView block={{ ...grid, emptyText: "No articles yet." }} data={data} />
    </main>
  );
}
