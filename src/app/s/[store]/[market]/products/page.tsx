import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ProductGrid, ProductListingFor } from "@/components/product-listing";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { listGridProducts } from "@/server/catalog";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/products">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return {};
  const { store, market } = shop;
  return {
    title: `${t(market.lang).allProducts} · ${store.name}`,
    alternates: { canonical: marketPath(store.slug, market.slug, "/products") },
  };
}

/**
 * All of a store's products in the market (D78): prerendered in the order
 * they were added, then sorted and filtered as the address asks, per
 * request. Menus link here with the "All products" link.
 */
export default async function ProductsPage({ params, searchParams }: Props) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  const products = await listGridProducts(store.id, market.code, market.locale, { categoryIds: [], tagIds: [], sort: "oldest", limit: 48 });

  return (
    <>
      <h1 className="mb-4 text-3xl font-heading tracking-tight">{m.allProducts}</h1>
      <Suspense
        fallback={
          products.length === 0 ? <p>{m.noProducts}</p> : <ProductGrid products={products} market={market} m={m} store={store.slug} base={base} />
        }
      >
        <ProductListingFor store={store} market={market} scope={{}} searchParams={searchParams} base={base} path={`${base}/products`} />
      </Suspense>
    </>
  );
}
