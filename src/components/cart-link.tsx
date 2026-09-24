import Link from "next/link";

import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { getCartCount } from "@/server/cart";

/** The header's cart link. Reads the cart cookie, so it renders per request. */
export async function CartLink({
  storeId,
  storeSlug,
  market,
}: {
  storeId: string;
  storeSlug: string;
  market: Market;
}) {
  const count = await getCartCount({ storeId, market });
  const m = t(market.lang);
  return (
    <Link
      href={marketPath(storeSlug, market.slug, "/cart")}
      className="rounded px-2 py-1 text-sm font-medium"
    >
      {count > 0 ? m.cartCount(count) : m.cart}
    </Link>
  );
}
