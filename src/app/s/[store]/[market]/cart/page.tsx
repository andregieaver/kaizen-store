import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PayRouteGuard } from "@/components/pay-route-guard";
import { RolePage } from "@/components/role-page";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { countryOffered, marketMoved, resolveAfterSaleShop, resolveShop, sellingPageOr404 } from "@/server/shop";
import type { Store } from "@/server/stores";

import { CartContents } from "./cart-contents";

type Props = PageProps<"/s/[store]/[market]/cart">;

async function load(params: Props["params"]) {
  const { store, market } = await params;
  return resolveShop(store, market);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shop = await load(params);
  return shop ? { title: t(shop.market.lang).cart, robots: { index: false } } : {};
}

/** The cart page: the store's own page for it (D113), where one is chosen; else a heading over the cart. */
export default async function CartPage({ params, searchParams }: Props) {
  const shop = await load(params);
  if (!shop) {
    const { store: storeSlug, market: marketSlug } = await params;
    // A cart in a country the store no longer sells to (D178) says so and leads to the store's own country; one in a language or currency
    // no longer offered moves to the same country's own address, where the cart is (a cart is the country's, whatever it is shown in).
    const kept = await resolveAfterSaleShop(storeSlug, marketSlug);
    if (kept && !countryOffered(kept.store, kept.market.code) && kept.store.markets[0]) return <CountryClosed store={kept.store} market={kept.market} />;
    return marketMoved(storeSlug, marketSlug, "/cart");
  }
  // A website (D178 step 5: the online shop off) has no cart.
  await sellingPageOr404(shop, "/cart");
  const { store, market } = shop;
  const m = t(market.lang);

  return (
    <>
      {/* Loads the page afresh if the document has been elsewhere: nothing another page added runs where a card is typed (wave 1, 1e). */}
      <PayRouteGuard store={store.slug} />
      <RolePage store={store} market={market} ab={shop.ab} role="cart" route={{ part: "cart", query: searchParams }}>
        <h1 className="mb-6 text-3xl font-heading tracking-tight">{m.cart}</h1>
        <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
          <CartContents store={store} market={market} m={m} />
        </Suspense>
      </RolePage>
    </>
  );
}

/** The cart of a country the store no longer sells to (D178): nothing can be ordered from it, and the store's own country is a link away. */
function CountryClosed({ store, market }: { store: Store; market: Market }) {
  const m = t(market.lang);
  const home = store.markets[0];
  const names = new Intl.DisplayNames([market.locale], { type: "region" });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-heading tracking-tight">{m.cart}</h1>
      <p role="status">{m.cartCountryClosed(names.of(market.code) ?? market.name)}</p>
      <p>
        <Link href={marketPath(store.slug, home.slug)} hrefLang={home.lang} className="underline">
          {m.cartGoHome(names.of(home.code) ?? home.name)}
        </Link>
      </p>
    </div>
  );
}
