import Link from "next/link";
import { market as marketParam, store as storeParam } from "next/root-params";

import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { resolveShop } from "@/server/shop";

export default async function MarketNotFound() {
  const [storeSlug, marketSlug] = await Promise.all([storeParam(), marketParam()]);
  const shop = storeSlug && marketSlug ? await resolveShop(storeSlug, marketSlug) : null;
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
