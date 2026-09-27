import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";

import { ProductCard } from "@/components/product-card";
import { SearchBox } from "@/components/search-box";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { normalizeQuery } from "@/lib/search";
import { byName } from "@/lib/taxonomy";
import { logSearch, searchProducts } from "@/server/search";
import { resolveShop } from "@/server/shop";
import { siteTerms } from "@/server/taxonomy";

type Props = PageProps<"/s/[store]/[market]/search">;

// Results pages are for shoppers, not search engines.
export const metadata: Metadata = { robots: { index: false, follow: true } };

/**
 * Search in a store (Phase 2, S1): the store's products in the market that
 * match what was typed, as its product cards show them. Nothing found, it
 * offers the store's categories instead; every search is logged for the
 * store's zero-result rate.
 */
export default function SearchPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <Search params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Search({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  const raw = (await searchParams).q;
  const query = normalizeQuery(typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "");
  const typed = typeof raw === "string" ? raw.trim().slice(0, 100) : query;
  const where = { storeId: store.id, market };
  const products = query ? await searchProducts(where, query) : [];
  if (query) after(() => logSearch(where, query, products.length));
  const categories = query && products.length === 0
    ? (await siteTerms(store.id, "product")).filter((term) => term.kind === "category" && !term.parentId).sort(byName)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-heading tracking-tight">{m.search.title}</h1>
      <SearchBox
        store={store.slug}
        market={market.slug}
        base={base}
        defaultValue={typed}
        autoFocus={!query}
        labels={{
          label: m.search.label,
          placeholder: m.search.placeholder,
          submit: m.search.submit,
          suggestions: m.search.suggestions,
          showAll: m.search.showAll("#"),
        }}
      />
      {!query ? (
        <p className="text-muted">{m.search.start}</p>
      ) : products.length === 0 ? (
        <div className="flex flex-col gap-3" role="status">
          <p>{m.search.none(typed)}</p>
          {categories.length > 0 && (
            <>
              <p className="text-muted">{m.search.browse}</p>
              <ul className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <li key={category.id}>
                    <Link
                      href={`${base}/category/${category.slug}`}
                      className="inline-flex min-h-10 items-center rounded-button border border-border px-4 text-sm hover:bg-surface"
                    >
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <>
          <p role="status" className="text-muted">
            {m.search.results(products.length, typed)}
          </p>
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
        </>
      )}
    </div>
  );
}
