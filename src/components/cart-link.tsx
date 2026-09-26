import Link from "next/link";

import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { getCartCount } from "@/server/cart";

import { Icon } from "./icons";

/**
 * The cart link, with how many items it holds: a bag in the header, a
 * labelled icon in the phone's bottom bar. Reads the cart cookie, so it
 * renders per request (inside Suspense, with `CartLinkShell` meanwhile).
 */
export async function CartLink({
  storeId,
  storeSlug,
  market,
  variant = "header",
}: {
  storeId: string;
  storeSlug: string;
  market: Market;
  variant?: "header" | "bar";
}) {
  const count = await getCartCount({ storeId, market });
  return <CartLinkShell storeSlug={storeSlug} market={market} variant={variant} count={count} />;
}

export function CartLinkShell({
  storeSlug,
  market,
  variant = "header",
  count = 0,
}: {
  storeSlug: string;
  market: Market;
  variant?: "header" | "bar";
  count?: number;
}) {
  const m = t(market.lang);
  const badge = count > 0 && (
    <span
      aria-hidden="true"
      className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold text-accent-foreground"
    >
      {count}
    </span>
  );
  const name = count > 0 ? m.cartCount(count) : m.cart;
  if (variant === "bar") {
    return (
      <Link href={marketPath(storeSlug, market.slug, "/cart")} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs">
        <span className="relative">
          <Icon name="bag" />
          {badge}
        </span>
        <span aria-hidden="true">{m.cart}</span>
        <span className="sr-only">{name}</span>
      </Link>
    );
  }
  return (
    <Link
      href={marketPath(storeSlug, market.slug, "/cart")}
      className="relative flex size-11 items-center justify-center rounded-full hover:bg-current/5"
    >
      <Icon name="bag" />
      {badge}
      <span className="sr-only">{name}</span>
    </Link>
  );
}
