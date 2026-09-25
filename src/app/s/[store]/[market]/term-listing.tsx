import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductCard } from "@/components/product-card";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { byName, withDescendants, type TermKind } from "@/lib/taxonomy";
import { listGridProducts } from "@/server/catalog";
import { resolveShop } from "@/server/shop";
import { siteTerms } from "@/server/taxonomy";

/**
 * A store's products in one category (with its subcategories) or with one
 * tag (D50): where the store's menu links to them lead. Shared by the
 * `category/[slug]` and `tag/[slug]` routes.
 */

type Params = Promise<{ store: string; market: string; slug: string }>;

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
  if (!shop) return null;
  const terms = await siteTerms(shop.store.id, "product");
  const term = terms.find((t) => t.kind === kind && t.slug === slug);
  return term ? { ...shop, terms, term } : null;
}

export async function termMetadata(kind: TermKind, params: Params): Promise<Metadata> {
  const loaded = await load(kind, params);
  if (!loaded) return {};
  const { store, market, term } = loaded;
  return {
    title: `${term.name} · ${store.name}`,
    alternates: { canonical: marketPath(store.slug, market.slug, `/${kind}/${term.slug}`) },
  };
}

export async function TermProducts({ kind, params }: { kind: TermKind; params: Params }) {
  const loaded = await load(kind, params);
  if (!loaded) notFound();
  const { store, market, terms, term } = loaded;
  const m = t(market.lang);
  const products = await listGridProducts(store.id, market.code, market.locale, {
    categoryIds: kind === "category" ? withDescendants(terms, [term.id]) : [],
    tagIds: kind === "tag" ? [term.id] : [],
    sort: "oldest",
    limit: 48,
  });
  const subcategories = kind === "category" ? terms.filter((t) => t.parentId === term.id).sort(byName) : [];
  const base = marketPath(store.slug, market.slug);

  return (
    <>
      <h1 className="mb-4 text-3xl font-semibold tracking-tight">{term.name}</h1>
      {subcategories.length > 0 && (
        <nav aria-label={term.name} className="mb-6">
          <ul className="flex flex-wrap gap-2">
            {subcategories.map((sub) => (
              <li key={sub.id}>
                <Link
                  href={`${base}/category/${sub.slug}`}
                  className="inline-flex min-h-10 items-center rounded-full border border-border px-4 text-sm hover:bg-surface"
                >
                  {sub.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {products.length === 0 ? (
        <p>{m.noProducts}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.handle}
              product={product}
              href={`${base}/p/${product.handle}`}
              market={market}
              m={m}
              store={store.slug}
              base={base}
            />
          ))}
        </ul>
      )}
    </>
  );
}
