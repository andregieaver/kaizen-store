import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";

import { ProductCard } from "@/components/product-card";
import { SearchBox } from "@/components/search-box";
import { t, type Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import type { SearchFilters } from "@/lib/query-understanding";
import { normalizeQuery } from "@/lib/search";
import { byName, type Term } from "@/lib/taxonomy";
import { understandQuery } from "@/server/query-understanding";
import { queryVector } from "@/server/query-vector";
import { logSearch, searchProducts } from "@/server/search";
import { resolveShop } from "@/server/shop";
import { siteTerms } from "@/server/taxonomy";

type Props = PageProps<"/s/[store]/[market]/search">;

// Results pages are for shoppers, not search engines.
export const metadata: Metadata = { robots: { index: false, follow: true } };

/**
 * Search in a store (Phase 2, S1, S2): the store's products in the market
 * that match what was typed, by its words and, with the store's AI, by its
 * meaning, as its product cards show them. Nothing found, it
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
  const asked = await searchParams;
  const raw = asked.q;
  const query = normalizeQuery(typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "");
  const typed = typeof raw === "string" ? raw.trim().slice(0, 100) : query;
  // `exact`: the shopper asked for the words as typed, not as understood.
  const exact = asked.exact === "1";
  const where = { storeId: store.id, market };
  const found = query ? await searchProducts(where, query, queryVector, exact ? null : understandQuery) : null;
  const products = found?.products ?? [];
  if (found) after(() => logSearch(where, query, products.length, found));
  const terms = query && (products.length === 0 || found?.filters) ? await siteTerms(store.id, "product") : [];
  const categories = products.length === 0 ? terms.filter((term) => term.kind === "category" && !term.parentId).sort(byName) : [];
  const understood = found?.filters ? describeFilters(found.filters, terms, m, market) : [];

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
          {understood.length > 0 && <Understood parts={understood} exactHref={exactHref(base, typed)} m={m} typed={typed} />}
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
          {understood.length > 0 && <Understood parts={understood} exactHref={exactHref(base, typed)} m={m} typed={typed} />}
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

const exactHref = (base: string, typed: string) => `${base}/search?q=${encodeURIComponent(typed)}&exact=1`;

/**
 * What the store's text model understood a search as (D75), in words
 * Kaizen writes: category and tag names from the store, prices formatted
 * here from checked numbers. Nothing the model wrote is shown but the
 * shopper's own words it kept.
 */
function describeFilters(filters: SearchFilters, terms: Term[], m: Messages, market: { locale: string; currency: string }): string[] {
  const name = (slug: string, kind: Term["kind"]) => terms.find((term) => term.kind === kind && term.slug === slug)?.name;
  // The shopper's own amount, not a product's price: shown as they typed it, with VAT as products' prices are compared.
  const money = (minor: number) => formatMoney(minor, market.currency, market.locale);
  const { minPriceMinor: min, maxPriceMinor: max } = filters;
  return [
    filters.text ? m.search.words(filters.text) : null,
    ...filters.categories.map((slug) => name(slug, "category")),
    ...filters.tags.map((slug) => name(slug, "tag")),
    filters.kind ? m.search.kinds[filters.kind] : null,
    min !== null && max !== null ? m.search.between(money(min), money(max)) : max !== null ? m.search.under(money(max)) : min !== null ? m.search.over(money(min)) : null,
    filters.inStock ? m.search.inStock : null,
    m.search.sorts[filters.sort] || null,
  ].filter((part): part is string => Boolean(part));
}

function Understood({ parts, exactHref, m, typed }: { parts: string[]; exactHref: string; m: Messages; typed: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">{m.search.understood}</span>
      <ul className="flex flex-wrap gap-2">
        {parts.map((part) => (
          <li key={part} className="rounded-button bg-surface px-3 py-1">
            {part}
          </li>
        ))}
      </ul>
      <Link href={exactHref} className="underline">
        {m.search.exact(typed)}
      </Link>
    </div>
  );
}
