import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContentGridView } from "@/components/content-grid";
import type { ContentGridBlock } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";
import { byName, type TermKind } from "@/lib/taxonomy";
import { gridData } from "@/server/content-grid";
import { siteTerms } from "@/server/taxonomy";

/**
 * Kaizen's published pages in one category (with its subcategories) or
 * with one tag (D50), as a content grid: where the menus' category and tag
 * links lead. Shared by `/category/[slug]` and `/tag/[slug]`.
 */

type Params = Promise<{ slug: string }>;

export async function termStaticParams(kind: TermKind) {
  const terms = (await siteTerms(null, "page")).filter((t) => t.kind === kind);
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return terms.length > 0 ? terms.map((term) => ({ slug: term.slug })) : [{ slug: "_" }];
}

async function load(kind: TermKind, params: Params) {
  const { slug } = await params;
  const terms = await siteTerms(null, "page");
  const term = terms.find((t) => t.kind === kind && t.slug === slug);
  return term ? { terms, term } : null;
}

export async function termMetadata(kind: TermKind, params: Params): Promise<Metadata> {
  const loaded = await load(kind, params);
  if (!loaded) return {};
  return { title: loaded.term.name, alternates: { canonical: `/${kind}/${loaded.term.slug}` } };
}

export async function TermPages({ kind, params }: { kind: TermKind; params: Params }) {
  const loaded = await load(kind, params);
  if (!loaded) notFound();
  const { terms, term } = loaded;
  const grid: ContentGridBlock = {
    ...(newBlock("contentGrid", () => `listing-${term.id}`) as ContentGridBlock),
    categories: kind === "category" ? [term.id] : [],
    tags: kind === "tag" ? [term.id] : [],
    limit: 48,
    emptyText: "No pages here yet.",
  };
  const data = await gridData(grid, { pageId: null, owner: null });
  const subcategories = kind === "category" ? terms.filter((t) => t.parentId === term.id).sort(byName) : [];

  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{term.name}</h1>
      {subcategories.length > 0 && (
        <nav aria-label={term.name}>
          <ul className="flex flex-wrap gap-2">
            {subcategories.map((sub) => (
              <li key={sub.id}>
                <Link
                  href={`/category/${sub.slug}`}
                  className="inline-flex min-h-10 items-center rounded-full border border-border px-4 text-sm hover:bg-surface"
                >
                  {sub.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <ContentGridView block={grid} data={data} />
    </main>
  );
}
