import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RolePage } from "@/components/role-page";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { resolveShop } from "@/server/shop";

import { CookiesSection } from "./cookies-section";

type Props = PageProps<"/s/[store]/[market]/cookies">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return {};
  return {
    title: t(shop.market.lang).cookies,
    alternates: { canonical: marketPath(shop.store.slug, shop.market.slug, "/cookies") },
  };
}

/** A store's cookie page (D58), in the market's language: the store's own page for it (D113), where one is chosen; else the standard list. */
export default async function StoreCookiesPage({ params, searchParams }: Props) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  return (
    <RolePage store={store} market={market} role="cookies" route={{ part: "cookies", query: searchParams }}>
      <CookiesSection store={store} market={market} />
    </RolePage>
  );
}
