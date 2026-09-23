import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { t } from "@/lib/i18n";
import { MARKET_SLUGS, MARKETS, marketForCountry } from "@/lib/markets";

/**
 * The market chooser. It suggests a market from the visitor's country but
 * never redirects: visitors choose, and search engines see every market.
 */
export default function Chooser() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Kaizen Store</h1>
      <p className="text-lg text-muted">
        <span lang="nb">{t("no").chooseMarket}</span> ·{" "}
        <span lang="sv">{t("se").chooseMarket}</span> ·{" "}
        <span lang="da">{t("dk").chooseMarket}</span>
      </p>
      <ul className="grid gap-3 sm:grid-cols-3">
        {MARKET_SLUGS.map((slug) => (
          <li key={slug}>
            <Link
              href={`/${slug}`}
              hrefLang={MARKETS[slug].lang}
              lang={MARKETS[slug].lang}
              className="block rounded-lg border border-border px-4 py-3 font-medium hover:bg-surface"
            >
              {MARKETS[slug].name}
            </Link>
          </li>
        ))}
      </ul>
      <Suspense fallback={null}>
        <Suggestion />
      </Suspense>
    </main>
  );
}

async function Suggestion() {
  const country = (await headers()).get("x-vercel-ip-country");
  const market = marketForCountry(country);
  if (!market) return null;
  const m = t(market.slug);
  return (
    <p lang={market.lang}>
      <Link href={`/${market.slug}`} className="underline">
        {m.products} · {market.name}
      </Link>
    </p>
  );
}
