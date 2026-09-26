import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CookiePolicy } from "@/components/consent/cookie-policy";
import { liveCustomCode } from "@/lib/custom-code";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { resolveShop } from "@/server/shop";
import { siteCookies } from "@/server/site-cookies";

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

/** A store's cookie page (D58), in the market's language. */
export default async function StoreCookiesPage({ params }: Props) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { cookies, categories } = await siteCookies(shop.store.id, shop.store.tracking, liveCustomCode(shop.store.customCode), {
    buyers: shop.store.audience === "both",
  });
  return <CookiePolicy lang={shop.market.lang} cookies={cookies} categories={categories} />;
}
