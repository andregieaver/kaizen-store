import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { codeFromSearch } from "@/lib/affiliates";
import { isBot } from "@/lib/experiments";
import { languageCookieName, type Visitor } from "@/lib/language-rule";
import { firstSlug } from "@/lib/language-view";
import { t } from "@/lib/i18n";
import { marketForCountry, type Market } from "@/lib/markets";
import { marketPath, marketHome } from "@/lib/paths";
import { affiliateSite } from "@/server/affiliates";
import { getOpenStore, type Store } from "@/server/stores";

/**
 * A store's front door. With one market it goes straight there (a store that sells in one country is served its country's front page here
 * by the proxy, D181, and never reaches it); with several
 * it suggests one from the visitor's country but never redirects, so visitors
 * choose and search engines see every market.
 */
export default async function Chooser({ params, searchParams }: PageProps<"/s/[store]">) {
  const store = await getOpenStore((await params).store);
  if (!store || store.markets.length === 0) notFound();
  if (store.markets.length === 1) {
    // The long address: a store that sells in one country is served here only while the proxy has not yet read that it does (D181), and the
    // long address is served then, where the short one would come back here.
    const target = marketPath(store.slug, store.markets[0].slug, "", null);
    // A friend's referral link (D131) keeps its code through the redirect, which needs the address: only while the store's
    // program (or the creator programme, D386) is on, so every other front door is still redirected as before.
    if (!(await affiliateSite(store.id)).capture) redirect(target);
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
      {/* Each country in its own language as the page is drawn; for a visitor, in the language the store's rule picks (D479). */}
      <Suspense fallback={<MarketLinks store={store} slugs={null} />}>
        <VisitorMarketLinks store={store} />
      </Suspense>
      <Suspense fallback={null}>
        <Suggestion store={store} />
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

/** What is known of the visitor at the front door (D479), or null for a crawler: it is shown each country's own view. */
async function visitorOf(store: Store): Promise<Visitor | null> {
  const request = await headers();
  if (isBot(request.get("user-agent"))) return null;
  return {
    country: request.get("x-vercel-ip-country"),
    acceptLanguage: request.get("accept-language"),
    remembered: (await cookies()).get(languageCookieName(store.id))?.value ?? null,
  };
}

/** Each country's first view for this visitor (D479): its slug by market code, null where every country is shown in its own. */
async function visitorSlugs(store: Store): Promise<Record<string, string> | null> {
  const visitor = await visitorOf(store);
  return visitor ? Object.fromEntries(store.markets.map((market) => [market.code, firstSlug(market, store.localization, visitor)])) : null;
}

function MarketLinks({ store, slugs }: { store: Store; slugs: Record<string, string> | null }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {store.markets.map((market) => (
        <li key={market.slug}>
          <Link
            href={marketHome(store.slug, slugs?.[market.code] ?? market.slug)}
            hrefLang={market.lang}
            lang={market.lang}
            className="block rounded-lg border border-border px-4 py-3 font-medium hover:bg-surface"
          >
            {market.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function VisitorMarketLinks({ store }: { store: Store }) {
  return <MarketLinks store={store} slugs={await visitorSlugs(store)} />;
}

async function Suggestion({ store }: { store: Store }) {
  const country = (await headers()).get("x-vercel-ip-country");
  const market: Market | null = marketForCountry(store.markets, country);
  if (!market) return null;
  const slug = (await visitorSlugs(store))?.[market.code] ?? market.slug;
  return (
    <p lang={market.lang}>
      <Link href={marketHome(store.slug, slug)} className="underline">
        {t(market.lang).products} · {market.name}
      </Link>
    </p>
  );
}
