import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CartLink } from "@/components/cart-link";

import { t } from "@/lib/i18n";
import { MARKET_SLUGS, MARKETS, getMarket } from "@/lib/markets";
import { siteUrl } from "@/lib/site";

import "../globals.css";

export function generateStaticParams() {
  return MARKET_SLUGS.map((market) => ({ market }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[market]">): Promise<Metadata> {
  const market = getMarket((await params).market);
  if (!market) return {};
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: "Kaizen Store", template: "%s · Kaizen Store" },
    description: t(market.slug).storeTagline,
    alternates: {
      canonical: `/${market.slug}`,
      languages: Object.fromEntries(
        MARKET_SLUGS.map((slug) => [MARKETS[slug].locale, `/${slug}`]),
      ),
    },
  };
}

export default async function MarketLayout({
  children,
  params,
}: LayoutProps<"/[market]">) {
  const market = getMarket((await params).market);
  if (!market) notFound();
  const m = t(market.slug);

  return (
    <html lang={market.lang} className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-background focus:p-2"
        >
          {market.lang === "nb" ? "Hopp til innhold" : market.lang === "sv" ? "Hoppa till innehåll" : "Spring til indhold"}
        </a>
        <p className="bg-foreground px-4 py-2 text-center text-sm text-background">
          {m.demoNotice}
        </p>
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href={`/${market.slug}`} className="text-lg font-semibold">
              Kaizen Store
            </Link>
            <div className="flex items-center gap-4">
            <nav aria-label={m.chooseMarket}>
              <ul className="flex gap-3 text-sm">
                {MARKET_SLUGS.map((slug) => (
                  <li key={slug}>
                    <Link
                      href={`/${slug}`}
                      hrefLang={MARKETS[slug].lang}
                      lang={MARKETS[slug].lang}
                      aria-current={slug === market.slug ? "page" : undefined}
                      className="rounded px-2 py-1 aria-[current=page]:bg-surface aria-[current=page]:font-semibold"
                    >
                      {MARKETS[slug].name}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <Suspense
              fallback={
                <Link href={`/${market.slug}/cart`} className="rounded px-2 py-1 text-sm font-medium">
                  {m.cart}
                </Link>
              }
            >
              <CartLink market={market} />
            </Suspense>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-border">
          <p className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted">
            Kaizen Store · {m.storeTagline}
          </p>
        </footer>
      </body>
    </html>
  );
}
