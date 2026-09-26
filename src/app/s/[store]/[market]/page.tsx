import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { JsonLdScript } from "@/components/json-ld";
import { PageEditLink } from "@/components/page-edit-link";
import { ProductCard } from "@/components/product-card";
import { StorePageArticle } from "@/components/store-page-article";
import { t } from "@/lib/i18n";
import { localizePage } from "@/lib/page-translation";
import { marketPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { storeHomeJsonLd } from "@/lib/structured-data";
import { listProducts } from "@/server/catalog";
import { listPublishedPages } from "@/server/pages";
import { storeFacts, storeShareImage, storeShareTags } from "@/server/seo";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]">;

async function load(params: Props["params"]) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return null;
  // The store's chosen front page (D54), while it is published; else the product list.
  const frontPage = shop.store.frontPageId
    ? ((await listPublishedPages(shop.store.id)).find((p) => p.id === shop.store.frontPageId) ?? null)
    : null;
  return { ...shop, frontPage };
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

export default async function MarketHome({ params }: Props) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { store, market, frontPage } = loaded;
  const m = t(market.lang);
  const products = await listProducts(store.id, market.code, market.locale);
  const origin = siteUrl();
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
          content={localizePage(frontPage.content, market.locale)}
          place={{ pageId: frontPage.id, owner: store.id, market: market.code }}
        />
        <PageEditLink pageId={frontPage.id} store={store.slug} />
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
            />
          ))}
        </ul>
      )}
    </>
  );
}
