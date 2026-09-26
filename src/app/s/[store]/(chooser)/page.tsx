import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { t } from "@/lib/i18n";
import { marketForCountry, type Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { getOpenStore } from "@/server/stores";

/**
 * A store's front door. With one market it goes straight there; with several
 * it suggests one from the visitor's country but never redirects, so visitors
 * choose and search engines see every market.
 */
export default async function Chooser({ params }: PageProps<"/s/[store]">) {
  const store = await getOpenStore((await params).store);
  if (!store || store.markets.length === 0) notFound();
  if (store.markets.length === 1) redirect(marketPath(store.slug, store.markets[0].slug));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-heading tracking-tight">{store.name}</h1>
      <p className="text-lg text-muted">
        {store.markets.map((market, index) => (
          <span key={market.slug}>
            {index > 0 && " · "}
            <span lang={market.lang}>{t(market.lang).chooseMarket}</span>
          </span>
        ))}
      </p>
      <ul className="grid gap-3 sm:grid-cols-3">
        {store.markets.map((market) => (
          <li key={market.slug}>
            <Link
              href={marketPath(store.slug, market.slug)}
              hrefLang={market.lang}
              lang={market.lang}
              className="block rounded-lg border border-border px-4 py-3 font-medium hover:bg-surface"
            >
              {market.name}
            </Link>
          </li>
        ))}
      </ul>
      <Suspense fallback={null}>
        <Suggestion storeSlug={store.slug} markets={store.markets} />
      </Suspense>
    </main>
  );
}

async function Suggestion({ storeSlug, markets }: { storeSlug: string; markets: Market[] }) {
  const country = (await headers()).get("x-vercel-ip-country");
  const market = marketForCountry(markets, country);
  if (!market) return null;
  return (
    <p lang={market.lang}>
      <Link href={marketPath(storeSlug, market.slug)} className="underline">
        {t(market.lang).products} · {market.name}
      </Link>
    </p>
  );
}
