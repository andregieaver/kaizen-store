import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { pageRoomClass } from "@/components/page-article";
import { ProductJsonLdSection, ProductLayoutView, type ProductPageContext } from "@/components/product-parts";
import { HeaderOverlayMark } from "@/components/store-chrome";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { minorUnitDigits } from "@/lib/money";
import { localizePage } from "@/lib/page-translation";
import { marketPath } from "@/lib/paths";
import { DEFAULT_PRODUCT_LAYOUT } from "@/lib/product-layout";
import { headerOverlays } from "@/lib/site-layout";
import { schemaPrice, summarize } from "@/lib/seo";
import { getProduct, listProducts } from "@/server/catalog";
import { campaignNotices } from "@/server/campaign-notices";
import { productsPageOf } from "@/server/pages";
import { productLayoutFor } from "@/server/product-layouts";
import { siteLayoutFor } from "@/server/site-layouts";
import { listIndexedProducts, storeShareImage, storeShareTags } from "@/server/seo";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/p/[handle]">;

/**
 * Prerender every product known at build time, so its text, price and safety
 * details are plain HTML for shoppers and crawlers; only stock streams in.
 * Products added later are rendered on first visit and then cached.
 */
export async function generateStaticParams({
  params,
}: {
  params: { store: string; market: string };
}) {
  const shop = await resolveShop(params.store, params.market);
  const products = shop
    ? await listProducts(shop.store.id, shop.market)
    : [];
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return products.length > 0
    ? products.map((product) => ({ handle: product.handle }))
    : [{ handle: "_" }];
}

async function load(params: Props["params"]) {
  const { store: storeSlug, market: marketSlug, handle } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return null;
  const { store, market } = shop;
  const product = await getProduct(store.id, market, handle);
  return product ? { store, market, product } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded) return {};
  const { store, market, product } = loaded;
  const path = (m: Market) => marketPath(store.slug, m.slug, `/p/${product.handle}`);
  const title = product.seoTitle || product.title;
  const description =
    product.seoDescription ||
    summarize(product.description) ||
    t(market.lang).storeSummary(store.name, market.name);
  // The product's page in the other markets it is sold in.
  const indexed = (await listIndexedProducts(store.id)).find((p) => p.handle === product.handle);
  const markets = store.markets.filter((m) => indexed?.markets.includes(m.code) ?? m.code === market.code);
  const cheapest = product.variants[0].price;
  const digits = minorUnitDigits(cheapest.currency);
  return {
    // The owner's own search title is used as written; otherwise "Product · Store".
    title: product.seoTitle ? { absolute: product.seoTitle } : product.title,
    description,
    alternates: {
      canonical: path(market),
      languages: Object.fromEntries(markets.map((m) => [m.locale, path(m)])),
    },
    ...storeShareTags(store, market, {
      title,
      description,
      url: path(market),
      images:
        product.images.length > 0
          ? product.images.slice(0, 4).map((image) => ({ url: image.url, alt: image.alt || product.title }))
          : [storeShareImage(store, market.locale)],
    }),
    other: {
      "product:price:amount": schemaPrice(cheapest.amountMinor, digits),
      "product:price:currency": cheapest.currency,
    },
  };
}

/**
 * A product's page, laid out by its product layout (D79): the store's own,
 * or the built-in one. The layout's product components draw the product's
 * parts (`ProductPartView`), which are part of the page's shell outside any
 * Suspense boundary: React moves a finished boundary out of line (to be
 * swapped in by script) once the page before it passes about 12 kB, so a
 * product with a long description or several pictures would show nothing
 * without JavaScript. Only stock and free times stream in.
 */
export default async function ProductPage({ params }: Props) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { store, market, product } = loaded;
  // The back link returns to the store's All products page (D83), by its title in the market's language.
  const productsPage = await productsPageOf(store);
  const back = productsPage
    ? { href: marketPath(store.slug, market.slug, "/products"), title: localizePage(productsPage.content, market.locale).title }
    : null;
  const [layout, header, campaigns] = await Promise.all([
    productLayoutFor(store.id, product.id).then((own) => own ?? DEFAULT_PRODUCT_LAYOUT),
    siteLayoutFor(store.id, "header"),
    campaignNotices(store.id, market),
  ]);
  const ctx: ProductPageContext = { store, market, product, m: t(market.lang), back, campaigns };
  // A header over every page (D80) lies over a product page whose layout starts with a background.
  const over = headerOverlays(header?.content.overlay, { front: false, categories: [], tags: [], rows: layout.rows });

  return (
    <div className={`store-page ${pageRoomClass(layout, "pt-8", "pb-8")}`} data-header-overlay={over ? "" : undefined}>
      {over && <HeaderOverlayMark />}
      <ProductLayoutView layout={layout} ctx={ctx} />
      <Suspense fallback={null}>
        <ProductJsonLdSection store={store} market={market} product={product} />
      </Suspense>
    </div>
  );
}
