import Image from "next/image";
import Link from "next/link";

import { Price } from "@/components/price";
import type { Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { ProductSummary } from "@/server/catalog";

export function ProductCard({
  product,
  href,
  market,
  m,
}: {
  product: ProductSummary;
  href: string;
  market: Market;
  m: Messages;
}) {
  return (
    <li className="group relative flex flex-col gap-3">
      {product.image && (
        <Image
          src={product.image.url}
          alt={product.image.alt}
          width={400}
          height={400}
          unoptimized
          className="aspect-square w-full rounded-lg bg-surface object-cover"
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
