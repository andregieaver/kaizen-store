import Link from "next/link";

import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { getCartCount } from "@/server/cart";

/** The header's cart link. Reads the cart cookie, so it renders per request. */
export async function CartLink({ market }: { market: Market }) {
  const count = await getCartCount(market);
  const m = t(market.slug);
  return (
    <Link href={`/${market.slug}/cart`} className="rounded px-2 py-1 text-sm font-medium">
      {count > 0 ? m.cartCount(count) : m.cart}
    </Link>
  );
}
