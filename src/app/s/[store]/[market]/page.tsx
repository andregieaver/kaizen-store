import type { Metadata } from "next";

import { AbMarker } from "@/components/ab/ab-marker";
import { JsonLdScript } from "@/components/json-ld";
import { PageEditLink } from "@/components/page-edit-link";
import { ProductCard } from "@/components/product-card";
import { StorePageArticle } from "@/components/store-page-article";
import { t } from "@/lib/i18n";
import { localizePage } from "@/lib/page-translation";
import { adminOrigin, marketPath, storeSiteUrl } from "@/lib/paths";
import { storeHomeJsonLd } from "@/lib/structured-data";
import { campaignNotices } from "@/server/campaign-notices";
import { listProducts } from "@/server/catalog";
import { listPublishedPages } from "@/server/pages";
import { placePageForVisitor } from "@/server/role-pages";
import { storeFacts, storeShareImage, storeShareTags } from "@/server/seo";
import { marketMoved, resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]">;

async function load(params: Props["params"]) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return null;
  // The store's chosen front page (D54), while it is published; else the product list. While the page is in a test (D148, phase 10) and the
  // address carries the visitor's other version of it, that version.
  const chosen = shop.store.frontPageId
    ? ((await listPublishedPages(shop.store.id)).find((p) => p.id === shop.store.frontPageId) ?? null)
    : null;
  const { page: frontPage, test, version } = await placePageForVisitor(shop.store.id, "front", chosen, shop.ab);
  return { ...shop, frontPage, test, version };
}

/** A front page's own search and sharing texts, over the store's. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded?.frontPage) return {};
  const { store, market } = loaded;
  const c = localizePage(loaded.frontPage.content, market.locale);
  const title = c.seo.title || store.seo.title[market.locale] || store.name;
  // The page's own description, else the store's (the start of a front page's text rarely describes the store).
  const description =
    c.seo.description || store.seo.description[market.locale] || t(market.lang).storeSummary(store.name, market.name);
  return {
    ...(c.seo.title && { title: { absolute: c.seo.title } }),
    description,
    ...(!c.searchEngines && { robots: { index: false } }),
    ...storeShareTags(store, market, {
      title,
      description,
      url: marketPath(store.slug, market.slug),
      images: c.thumbnail
        ? [{ url: c.thumbnail.url, alt: c.thumbnail.alt || c.title, width: c.thumbnail.width, height: c.thumbnail.height }]
        : [storeShareImage(store, market.locale)],
    }),
  };
}

export default async function MarketHome({ params, searchParams }: Props) {
  const loaded = await load(params);
  // A country, language or currency the store no longer offers moves to one it does (D178).
  if (!loaded) return marketMoved((await params).store, (await params).market);
  const { store, market, frontPage, test, version } = loaded;
  const m = t(market.lang);
  const [products, notices] = await Promise.all([listProducts(store.id, market), campaignNotices(store.id, market)]);
  const origin = storeSiteUrl(store.slug);
  const productUrl = (handle: string) => marketPath(store.slug, market.slug, `/p/${handle}`);
  const jsonLd = (
    <JsonLdScript
      data={storeHomeJsonLd({
        store: storeFacts(store),
        origin,
        homeUrl: `${origin}${marketPath(store.slug, market.slug)}`,
        market,
        description: store.seo.description[market.locale] || m.storeSummary(store.name, market.name),
        productUrls: products.map((product) => `${origin}${productUrl(product.handle)}`),
      })}
    />
  );

  if (frontPage) {
    return (
      <>
        {jsonLd}
        <StorePageArticle
          front
          content={localizePage(frontPage.content, market.locale)}
          place={{
            pageId: frontPage.id,
            owner: store.id,
            market: market.slug,
            listing: { query: searchParams, path: marketPath(store.slug, market.slug) },
          }}
        />
        <PageEditLink pageId={frontPage.id} store={store.slug} adminOrigin={adminOrigin(store.slug)} />
        {/* A test of the front page (D148, phase 10): which version this is, for the exposure. */}
        {test && <AbMarker storeId={store.id} store={store.slug} market={market.slug} experiment={test.id} variant={version} goalBlock={test.goalBlock} />}
      </>
    );
  }

  return (
    <>
      {jsonLd}
      <h1 className="mb-6 text-3xl font-heading tracking-tight">{m.products}</h1>
      {products.length === 0 ? (
        <p>{m.noProducts}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.handle}
              product={product}
              href={productUrl(product.handle)}
              market={market}
              m={m}
              store={store.slug}
              base={marketPath(store.slug, market.slug)}
              notices={notices}
            />
          ))}
        </ul>
      )}
    </>
  );
}
