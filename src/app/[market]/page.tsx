import { notFound } from "next/navigation";

import { ProductCard } from "@/components/product-card";
import { t } from "@/lib/i18n";
import { getMarket } from "@/lib/markets";
import { listProducts } from "@/server/catalog";

export default async function MarketHome({ params }: PageProps<"/[market]">) {
  const market = getMarket((await params).market);
  if (!market) notFound();
  const m = t(market.slug);
  const products = await listProducts(market.code, market.locale);

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">{m.products}</h1>
      {products.length === 0 ? (
        <p>{m.noProducts}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.handle} product={product} market={market} m={m} />
          ))}
        </ul>
      )}
    </>
  );
}
