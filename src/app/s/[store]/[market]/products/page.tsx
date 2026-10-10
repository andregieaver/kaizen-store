import type { Metadata } from "next";
import { Suspense } from "react";

import { AbMarker } from "@/components/ab/ab-marker";
import { PageEditLink } from "@/components/page-edit-link";
import { ProductGrid, ProductListingFor } from "@/components/product-listing";
import { StorePageArticle } from "@/components/store-page-article";
import { t } from "@/lib/i18n";
import { localizePage } from "@/lib/page-translation";
import { adminOrigin, marketPath } from "@/lib/paths";
import { campaignNotices } from "@/server/campaign-notices";
import { listGridProducts } from "@/server/catalog";
import { productsPageOf } from "@/server/pages";
import { placePageForVisitor } from "@/server/role-pages";
import { storeShareImage, storeShareTags } from "@/server/seo";
import { marketMoved, resolveShop, sellingPageOr404 } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/products">;

async function load(params: Props["params"]) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return null;
  // The store's own All products page (D83) while it is published; else the standard list. While the page is in a test (D148, phase 10) and
  // the address carries the visitor's other version of it, that version.
  const { page, test, version } = await placePageForVisitor(shop.store.id, "products", await productsPageOf(shop.store), shop.ab);
  return { ...shop, page, test, version };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded) return {};
  const { store, market, page } = loaded;
  const url = marketPath(store.slug, market.slug, "/products");
  if (!page) {
    return { title: `${t(market.lang).allProducts} · ${store.name}`, alternates: { canonical: url } };
  }
  // The page's own title and search texts, at /products.
  const c = localizePage(page.content, market.locale);
  const title = c.seo.title || c.title;
  const description = c.seo.description || store.seo.description[market.locale] || undefined;
  return {
    title,
    description,
    alternates: { canonical: url },
    ...(!c.searchEngines && { robots: { index: false } }),
    ...storeShareTags(store, market, {
      title,
      description: description ?? title,
      url,
      images: c.thumbnail
        ? [{ url: c.thumbnail.url, alt: c.thumbnail.alt || c.title, width: c.thumbnail.width, height: c.thumbnail.height }]
        : [storeShareImage(store, market.locale)],
    }),
  };
}

/**
 * All of a store's products in the market: the store's All products page
 * (D83), built in the page builder, where one is chosen; else the standard
 * list (D78), prerendered in the order products were added, then sorted
 * and filtered as the address asks, per request. Menus link here with the
 * "All products" link.
 */
export default async function ProductsPage({ params, searchParams }: Props) {
  const loaded = await load(params);
  // A country, language or currency the store no longer offers moves to one it does (D178).
  if (!loaded) return marketMoved((await params).store, (await params).market, "/products");
  const { store, market, page, test, version } = loaded;
  // A website (D178 step 5: the online shop off) has no All products page: the store's 404, or a manual redirect.
  await sellingPageOr404(loaded, "/products");
  const base = marketPath(store.slug, market.slug);
  const path = `${base}/products`;

  if (page) {
    return (
      <>
        <StorePageArticle
          content={localizePage(page.content, market.locale)}
          place={{ pageId: page.id, owner: store.id, market: market.slug, archive: true, listing: { query: searchParams, path } }}
          editable={market.locale === store.localization.locales[0]}
        />
        <PageEditLink pageId={page.id} store={store.slug} adminOrigin={adminOrigin(store.slug)} textEditable={market.locale === store.localization.locales[0]} />
        {/* A test of the All products page (D148, phase 10): which version this is, for the exposure. */}
        {test && <AbMarker storeId={store.id} store={store.slug} market={market.slug} experiment={test.id} variant={version} goalBlock={test.goalBlock} />}
      </>
    );
  }

  const m = t(market.lang);
  const [products, notices] = await Promise.all([
    listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "oldest", limit: 48 }),
    campaignNotices(store.id, market),
  ]);
  return (
    <>
      <h1 className="mb-4 text-3xl font-heading tracking-tight">{m.allProducts}</h1>
      <Suspense
        fallback={
          products.length === 0 ? <p>{m.noProducts}</p> : <ProductGrid products={products} market={market} m={m} store={store.slug} base={base} notices={notices} />
        }
      >
        <ProductListingFor store={store} market={market} scope={{}} searchParams={searchParams} base={base} path={path} />
      </Suspense>
    </>
  );
}
