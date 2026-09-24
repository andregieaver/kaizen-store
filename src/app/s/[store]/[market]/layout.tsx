import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CartLink } from "@/components/cart-link";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { prerenderedShops, resolveShop } from "@/server/shop";
import type { Store } from "@/server/stores";

import "../../../globals.css";

type Props = LayoutProps<"/s/[store]/[market]">;

export function generateStaticParams() {
  return prerenderedShops();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return {};
  const { store, market } = shop;
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: store.name, template: `%s · ${store.name}` },
    // A store is not for search engines until its owner opens it.
    ...(store.setupCompletedAt || store.isTemplate ? {} : { robots: { index: false } }),
    alternates: {
      canonical: marketPath(store.slug, market.slug),
      languages: Object.fromEntries(
        store.markets.map((m) => [m.locale, marketPath(store.slug, m.slug)]),
      ),
    },
  };
}

export default async function MarketLayout({ children, params }: Props) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);
  const home = marketPath(store.slug, market.slug);

  return (
    <html lang={market.lang} className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-background focus:p-2"
        >
          {m.skipToContent}
        </a>
        {/* Shoppers are told when a store is a preview, cannot take payment yet, or takes test payments only. */}
        {(!(store.setupCompletedAt || store.isTemplate) || !store.paymentsOn || store.paymentsTest) && (
          <p className="bg-foreground px-4 py-2 text-center text-sm text-background">
            {[
              !(store.setupCompletedAt || store.isTemplate) && m.previewNotice,
              !store.paymentsOn && (store.setupCompletedAt || store.isTemplate) && m.demoNotice,
              store.paymentsOn && store.paymentsTest && m.testNotice,
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
        )}
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href={home} className="text-lg font-semibold">
              {store.name}
            </Link>
            <div className="flex items-center gap-4">
              {store.markets.length > 1 && (
                <nav aria-label={m.chooseMarket}>
                  <ul className="flex gap-3 text-sm">
                    {store.markets.map((other) => (
                      <li key={other.slug}>
                        <Link
                          href={marketPath(store.slug, other.slug)}
                          hrefLang={other.lang}
                          lang={other.lang}
                          aria-current={other.slug === market.slug ? "page" : undefined}
                          className="rounded px-2 py-1 aria-[current=page]:bg-surface aria-[current=page]:font-semibold"
                        >
                          {other.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
              <Suspense
                fallback={
                  <Link href={`${home}/cart`} className="rounded px-2 py-1 text-sm font-medium">
                    {m.cart}
                  </Link>
                }
              >
                <CartLink storeId={store.id} storeSlug={store.slug} market={market} />
              </Suspense>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-border">
          <StoreFooter store={store} />
        </footer>
      </body>
    </html>
  );
}

/** Who sells: required on every page of a web shop (e-commerce and consumer law). */
function StoreFooter({ store }: { store: Store }) {
  const d = store.details;
  const lines = [
    d.legalName ?? store.name,
    d.organisationNumber && `Org. ${d.organisationNumber}`,
    d.postalAddress?.replace(/\s*\n\s*/g, ", "),
  ].filter(Boolean);
  return (
    <div className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-4 py-6 text-sm text-muted">
      <span>{lines.join(" · ")}</span>
      {d.contactEmail && (
        <a href={`mailto:${d.contactEmail}`} className="underline">
          {d.contactEmail}
        </a>
      )}
    </div>
  );
}
