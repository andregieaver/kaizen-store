import { notFound } from "next/navigation";

import { ProductCard } from "@/components/product-card";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { listProducts } from "@/server/catalog";
import { resolveShop } from "@/server/shop";

export default async function MarketHome({ params }: PageProps<"/s/[store]/[market]">) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);
  const products = await listProducts(store.id, market.code, market.locale);

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">{m.products}</h1>
      {products.length === 0 ? (
        <p>{m.noProducts}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.handle}
              product={product}
              href={marketPath(store.slug, market.slug, `/p/${product.handle}`)}
              market={market}
              m={m}
            />
          ))}
        </ul>
      )}
    </>
  );
}
