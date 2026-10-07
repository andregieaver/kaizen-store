import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { codeFromSearch } from "@/lib/affiliates";
import { t } from "@/lib/i18n";
import { marketForCountry, type Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { affiliateSite } from "@/server/affiliates";
import { getOpenStore } from "@/server/stores";

/**
 * A store's front door. With one market it goes straight there; with several
 * it suggests one from the visitor's country but never redirects, so visitors
 * choose and search engines see every market.
 */
export default async function Chooser({ params, searchParams }: PageProps<"/s/[store]">) {
  const store = await getOpenStore((await params).store);
  if (!store || store.markets.length === 0) notFound();
  if (store.markets.length === 1) {
    const target = marketPath(store.slug, store.markets[0].slug);
    // A friend's referral link (D131) keeps its code through the redirect, which needs the address: only while the store's
    // program is on, so every other front door is still redirected as before.
    if (!(await affiliateSite(store.id)).on) redirect(target);
    return (
      <Suspense fallback={null}>
        <KeepReferral target={target} searchParams={searchParams} />
      </Suspense>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-heading tracking-tight">{store.name}</h1>
      {/* A store template (D175) says it is a preview, as its markets' header does. */}
      {store.starter && (
        <p role="note" lang={store.markets[0].lang} className="text-sm">
          {t(store.markets[0].lang).starterNotice}
        </p>
      )}
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

/** The one market's address, with the friend's code in it when the front door was opened with one (D131). */
async function KeepReferral({ target, searchParams }: { target: string; searchParams: PageProps<"/s/[store]">["searchParams"] }): Promise<never> {
  const ref = (await searchParams).ref;
  const code = codeFromSearch(`?ref=${encodeURIComponent(Array.isArray(ref) ? (ref[0] ?? "") : (ref ?? ""))}`);
  redirect(code ? `${target}?ref=${code}` : target);
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
