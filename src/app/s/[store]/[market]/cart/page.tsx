import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { t } from "@/lib/i18n";
import { resolveShop } from "@/server/shop";

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

export default async function CartPage({ params }: Props) {
  const shop = await load(params);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);

  return (
    <>
      <h1 className="mb-6 text-3xl font-heading tracking-tight">{m.cart}</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <CartContents store={store} market={market} m={m} />
      </Suspense>
    </>
  );
}
