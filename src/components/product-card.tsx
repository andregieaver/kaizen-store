import Image from "next/image";
import Link from "next/link";

import { Price } from "@/components/price";
import { WishlistHeart } from "@/components/wishlist-heart";
import { audienceClass } from "@/lib/b2b";
import type { Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { ProductSummary } from "@/server/catalog";

export function ProductCard({
  product,
  href,
  market,
  m,
  store,
  base,
}: {
  product: ProductSummary;
  href: string;
  market: Market;
  m: Messages;
  /** The store's slug and the market's path, for the wishlist heart (D34). */
  store: string;
  base: string;
}) {
  return (
    // The theme draws the card (D60): its picture's shape, and plain, bordered or raised, left or centred.
    // Shown only to the shoppers it is for (B2B).
    <li className={`product-card group relative flex flex-col gap-3 ${audienceClass(product.audience)}`}>
      <WishlistHeart
        store={store}
        market={market.slug}
        base={base}
        productId={product.id}
        labels={{ save: m.wishlist.save(product.title), saved: m.wishlist.saved, removed: m.wishlist.removed }}
      />
      {product.image && (
        <Image
          src={product.image.url}
          alt={product.image.alt}
          width={400}
          height={400}
          unoptimized
          className="product-card-image w-full rounded-lg bg-surface object-cover"
        />
      )}
      <h2 className="font-medium">
        <Link
          href={href}
          className="after:absolute after:inset-0 focus-visible:outline-2"
        >
          {product.title}
        </Link>
      </h2>
      <Price price={product.price} locale={market.locale} m={m} from={product.priceVaries} />
    </li>
  );
}
