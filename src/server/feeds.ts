import "server-only";

import { feedProblems, type FeedAvailability, type FeedItem, type FeedProblem } from "@/lib/feeds";
import type { Market } from "@/lib/markets";
import { marketUrl } from "@/lib/paths";
import { absoluteUrl } from "@/lib/seo";
import { availabilityOf } from "@/lib/stock-availability";

import { getProduct, getVariantStock, listProducts } from "./catalog";
import { getShippingFacts } from "./seo";
import type { Store } from "./stores";

/**
 * A store's product feed in one market (wave 5 unit H, D302, `docs/wave-5-marketing.md` 13): its offered products read through the
 * catalogue's own cached reads, so the price is the one the storefront shows (with VAT, in the market's currency), and stock per request.
 * One item per active variant; a product that cannot be advertised is left out and named with its reasons.
 */

export type LeftOut = { productId: string; handle: string; title: string; problems: FeedProblem[] };

export type StoreFeed = { items: FeedItem[]; leftOut: LeftOut[] };

const plain = (text: string) =>
  text
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_#`>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

export async function storeFeed(store: Store, market: Market): Promise<StoreFeed> {
  const origin = new URL(marketUrl(store.slug, market.slug, "", store.address)).origin;
  const summaries = await listProducts(store.id, market);
  const products = (await Promise.all(summaries.map((p) => getProduct(store.id, market, p.handle)))).filter((p) => p !== null);
  const stock = await getVariantStock(
    store.id,
    products.flatMap((p) => p.variants.map((v) => v.id)),
  );
  const shipping = await getShippingFacts(store.id, market);
  const items: FeedItem[] = [];
  const leftOut: LeftOut[] = [];
  for (const product of products) {
    const problems = feedProblems({
      kind: product.kind,
      subscriptionOnly: product.subscriptionOnly,
      audience: product.audience,
      hasPicture: product.images.length > 0 || product.variants.some((v) => v.image),
      hasPrice: product.variants.length > 0,
    });
    if (problems.length > 0) {
      leftOut.push({ productId: product.id, handle: product.handle, title: product.title, problems });
      continue;
    }
    const link = marketUrl(store.slug, market.slug, `/p/${product.handle}`, store.address);
    const productImages = product.images.map((image) => absoluteUrl(image.url, origin));
    for (const variant of product.variants) {
      const options = Object.values(variant.options).filter(Boolean);
      const own = stock.get(variant.id);
      const availability: FeedAvailability = variant.delivery === "physical" && own ? availabilityOf(own) : "in_stock";
      const shipped = variant.delivery === "physical";
      items.push({
        id: variant.sku || variant.id,
        groupId: product.id,
        title: options.length > 0 && product.variants.length > 1 ? `${product.title} – ${options.join(", ")}` : product.title,
        description: plain(product.description),
        link,
        images: [...new Set([...(variant.image ? [absoluteUrl(variant.image.url, origin)] : []), ...productImages])],
        priceMinor: variant.price.amountMinor,
        referenceMinor: variant.price.referenceMinor,
        currency: variant.price.currency,
        availability,
        gtin: variant.gtin,
        brand: product.manufacturer?.name ?? store.name,
        measure: variant.measure,
        shippingMinor:
          !shipped || shipping === null
            ? null
            : shipping.freeOverMinor !== null && variant.price.amountMinor >= shipping.freeOverMinor
              ? 0
              : shipping.amountMinor,
        country: market.code,
      });
    }
  }
  return { items, leftOut };
}
