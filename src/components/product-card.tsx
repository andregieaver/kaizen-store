import Link from "next/link";

import { CampaignBadge } from "@/components/campaign-notice";
import { Price } from "@/components/price";
import { SizedPicture } from "@/components/sized-picture";
import { WishlistHeart } from "@/components/wishlist-heart";
import { audienceClass } from "@/lib/b2b";
import { noticesFor, type CampaignNotices } from "@/lib/campaign-notices";
import type { Messages } from "@/lib/i18n";
import { gridSizes } from "@/lib/picture-sizes";
import { releaseDate } from "@/lib/stock-words";
import type { Market } from "@/lib/markets";
import type { ProductSummary } from "@/server/catalog";

/** A card's width in the listing (`ProductListing`: two columns, four from Medium). */
const CARD_SIZES = gridSizes({ xl: 4, md: 4, sm: 2 });

export function ProductCard({
  product,
  href,
  market,
  m,
  store,
  base,
  tracked = false,
  notices,
}: {
  product: ProductSummary;
  href: string;
  /**
   * The link records the click on its way (search results, D77): a plain
   * link, so it is never prefetched, and not for crawlers to follow.
   */
  tracked?: boolean;
  market: Market;
  m: Messages;
  /** The store's slug and the market's path, for the wishlist heart (D34). */
  store: string;
  base: string;
  /** The store's campaigns (D115): the offer on this product shows as a badge. */
  notices?: CampaignNotices;
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
      <CampaignBadge notices={noticesFor(notices, product.id)} m={m} />
      {product.image && (
        // The small copy and the picture by width (D336), at the listing's two columns on a phone and four from Medium.
        <SizedPicture
          url={product.image.large ?? product.image.url}
          small={product.image.large ? product.image.url : null}
          sourceWidth={product.image.width}
          sizes={CARD_SIZES}
          alt={product.image.alt}
          width={400}
          height={400}
          className="product-card-image w-full rounded-lg bg-surface object-cover"
        />
      )}
      <h2 className="font-medium">
        {tracked ? (
          <a href={href} rel="nofollow" className="after:absolute after:inset-0 focus-visible:outline-2">
            {product.title}
          </a>
        ) : (
          <Link href={href} className="after:absolute after:inset-0 focus-visible:outline-2">
            {product.title}
          </Link>
        )}
      </h2>
      {/* Price on request (D431): the words in place of a price no shopper sees. */}
      {product.priceOnRequest ? (
        <p className="text-sm font-medium">{m.quotes.priceOnRequest}</p>
      ) : (
        <Price price={product.price} locale={market.locale} m={m} from={product.priceVaries} />
      )}
      {product.group && <GroupSwatches group={product.group} base={base} m={m} />}
      {product.preorderUntil && (
        <p className="text-sm text-muted" data-preorder>
          {m.preorder.page(releaseDate(product.preorderUntil, market.locale))}
        </p>
      )}
    </li>
  );
}

/** The other products of its combined listing (D566), each a link of its own above the card's link: a dot of its colour, or its value. */
export function GroupSwatches({ group, base, m }: { group: NonNullable<ProductSummary["group"]>; base: string; m: Messages }) {
  const shown = group.items.slice(0, 6);
  const more = group.items.length - shown.length;
  return (
    <ul className="relative z-10 flex flex-wrap items-center gap-1.5" aria-label={m.group.choose(group.option)} data-group-swatches>
      {shown.map((item) => (
        <li key={item.handle}>
          <Link
            href={`${base}/p/${item.handle}`}
            aria-label={`${group.option}: ${item.value}`}
            title={item.value}
            className={
              item.swatch
                ? "block size-5 rounded-full border border-line focus-visible:outline-2"
                : "block rounded-full border border-line px-2 text-xs leading-5 focus-visible:outline-2"
            }
            style={item.swatch ? { backgroundColor: item.swatch } : undefined}
          >
            {item.swatch ? null : item.value}
          </Link>
        </li>
      ))}
      {more > 0 && <li className="text-xs text-muted">+{more}</li>}
    </ul>
  );
}
