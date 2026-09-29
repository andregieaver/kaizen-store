import Link from "next/link";
import { market as marketParam, store as storeParam } from "next/root-params";

import { StorePageArticle } from "@/components/store-page-article";
import { t } from "@/lib/i18n";
import { localizePage } from "@/lib/page-translation";
import { marketPath } from "@/lib/paths";
import { pageForRole } from "@/server/pages";
import { resolveShop } from "@/server/shop";

/**
 * An address that does not exist in a store: the store's own 404 page (D112),
 * built in the page builder, where one is chosen; else a short message. It is
 * shown with a 404 status either way.
 */
export default async function MarketNotFound() {
  const [storeSlug, marketSlug] = await Promise.all([storeParam(), marketParam()]);
  const shop = storeSlug && marketSlug ? await resolveShop(storeSlug, marketSlug) : null;
  const page = shop ? await pageForRole(shop.store, "not_found") : null;
  if (shop && page) {
    return <StorePageArticle content={localizePage(page.content, shop.market.locale)} place={{ pageId: page.id, owner: shop.store.id, market: shop.market.slug }} />;
  }
  const m = t(shop?.market.lang ?? "en");
  return (
    <div className="flex flex-col gap-4 py-16">
      <h1 className="text-2xl font-heading">{m.notFound}</h1>
      <Link
        href={shop ? marketPath(shop.store.slug, shop.market.slug) : "/"}
        className="underline"
      >
        {m.toHome}
      </Link>
    </div>
  );
}
