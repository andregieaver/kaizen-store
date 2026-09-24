import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { BackToAdmin } from "@/components/back-to-admin";
import { StoreBottomBar, StoreFooter, StoreHeader, StoreMenu } from "@/components/store-layout";
import { t } from "@/lib/i18n";
import { marketPath, storeBase } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { storeShareImage, storeShareTags, verificationTags } from "@/server/seo";
import { prerenderedShops, resolveShop } from "@/server/shop";

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
  const title = store.seo.title[market.locale] || store.name;
  const description =
    store.seo.description[market.locale] || t(market.lang).storeSummary(store.name, market.name);
  const home = marketPath(store.slug, market.slug);
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s · ${store.name}` },
    description,
    // A store is not for search engines until its owner opens it, or while they hide it.
    ...(!(store.setupCompletedAt || store.isTemplate) || store.seo.hidden ? { robots: { index: false } } : {}),
    alternates: {
      canonical: home,
      languages: {
        ...Object.fromEntries(store.markets.map((m) => [m.locale, marketPath(store.slug, m.slug)])),
        // With several markets the store's front door lets visitors choose.
        "x-default": store.markets.length > 1 ? storeBase(store.slug) : home,
      },
    },
    ...storeShareTags(store, market, {
      title,
      description,
      url: home,
      images: [storeShareImage(store, market.locale)],
    }),
    verification: verificationTags(store.seo),
  };
}

export default async function MarketLayout({ children, params }: Props) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);

  return (
    <html lang={market.lang} className="h-full antialiased">
      {/* On phones the bottom bar covers the last 4rem, so the page ends above it. */}
      <body className="flex min-h-full flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] font-sans md:pb-0">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-background focus:p-2"
        >
          {m.skipToContent}
        </a>
        {/* Shoppers are told when a store is a preview, cannot take payment yet, or takes test payments only. */}
        <StoreHeader
          store={store}
          market={market}
          notice={
            [
              !(store.setupCompletedAt || store.isTemplate) && m.previewNotice,
              !store.paymentsOn && (store.setupCompletedAt || store.isTemplate) && m.demoNotice,
              store.paymentsOn && store.paymentsTest && m.testNotice,
            ]
              .filter(Boolean)
              .join(" ") || null
          }
        />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <StoreFooter store={store} market={market} />
        {/*
          Phone enhancements, each in its own boundary: React counts
          everything outside boundaries towards a 12.8 kB budget, past which
          the page's own content is sent as a block that needs JavaScript
          to show. Keeping these out keeps product pages readable without it.
        */}
        <Suspense fallback={null}>
          <StoreBottomBar store={store} market={market} />
        </Suspense>
        <Suspense fallback={null}>
          <StoreMenu store={store} market={market} />
        </Suspense>
        <BackToAdmin storeSlug={store.slug} />
      </body>
    </html>
  );
}
