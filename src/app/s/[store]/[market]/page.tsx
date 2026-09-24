import { notFound } from "next/navigation";

import { JsonLdScript } from "@/components/json-ld";
import { ProductCard } from "@/components/product-card";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { storeHomeJsonLd } from "@/lib/structured-data";
import { listProducts } from "@/server/catalog";
import { storeFacts } from "@/server/seo";
import { resolveShop } from "@/server/shop";

export default async function MarketHome({ params }: PageProps<"/s/[store]/[market]">) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);
  const products = await listProducts(store.id, market.code, market.locale);
  const origin = siteUrl();
  const productUrl = (handle: string) => marketPath(store.slug, market.slug, `/p/${handle}`);

  return (
    <>
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
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">{m.products}</h1>
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
            />
          ))}
        </ul>
      )}
    </>
  );
}
