import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { BackToAdmin } from "@/components/back-to-admin";
import { BuyerQuestion } from "@/components/buyer";
import { SiteConsent } from "@/components/consent/site-consent";
import { StoreBottomBar, StoreFooter, StoreHeader, StoreMenu } from "@/components/store-layout";
import { StoreThemeStyles } from "@/components/store-theme";
import { buyerScript } from "@/lib/b2b";
import { liveCustomCode } from "@/lib/custom-code";
import { t } from "@/lib/i18n";
import { adminOrigin, marketPath, storeHome, storeSiteUrl } from "@/lib/paths";
import { siteIcons } from "@/lib/site-icons";
import { themeAttributes } from "@/lib/theme";
import { siteFontStyle } from "@/server/fonts";
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
    metadataBase: new URL(storeSiteUrl(store.slug)),
    title: { default: title, template: `%s · ${store.name}` },
    description,
    // A store is not for search engines until its owner opens it, or while they hide it.
    ...(!(store.setupCompletedAt || store.isTemplate) || store.seo.hidden ? { robots: { index: false } } : {}),
    alternates: {
      canonical: home,
      languages: {
        ...Object.fromEntries(store.markets.map((m) => [m.locale, marketPath(store.slug, m.slug)])),
        // With several markets the store's front door lets visitors choose.
        "x-default": store.markets.length > 1 ? storeHome(store.slug) : home,
      },
    },
    ...storeShareTags(store, market, {
      title,
      description,
      url: home,
      images: [storeShareImage(store, market.locale)],
    }),
    verification: verificationTags(store.seo),
    // The store's icon (D62), or Kaizen's.
    icons: siteIcons(store.navigation.favicon),
  };
}

export default async function MarketLayout({ children, params }: Props) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);

  return (
    // The store's theme (D60): its choices as attributes, its colours and sizes as variables.
    // Stores selling to businesses show their prices without VAT (B2B); selling to both, the first script marks the shopper's kind.
    <html
      lang={market.lang}
      className="h-full antialiased"
      {...themeAttributes(store.theme.settings)}
      data-buyer={store.audience === "businesses" ? "business" : undefined}
      suppressHydrationWarning={store.audience === "both"}
    >
      {/* On phones the bottom bar covers the last 4rem, so the page ends above it. */}
      <body
        className="flex min-h-full flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] font-sans md:pb-0"
        style={siteFontStyle(store.fonts)}
      >
        {store.audience === "both" && <script dangerouslySetInnerHTML={{ __html: buyerScript(store.id) }} />}
        {/* The store's own fonts (D59) and theme (D60). */}
        <StoreThemeStyles store={store} />
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
        {/* A store's page (D54) spans the window: its rows keep to this width themselves. */}
        <main
          id="main"
          className="mx-auto w-full max-w-(--content-width) flex-1 px-4 py-8 has-[>.store-page]:max-w-none has-[>.store-page]:p-0"
        >
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
        {store.businessPopup && <BuyerQuestion storeId={store.id} labels={m.buyer} />}
        <BackToAdmin storeSlug={store.slug} adminOrigin={adminOrigin(store.slug)} />
        {/* Asks about the store's optional tools and code, if it has any, in the market's language (D58, D61). */}
        <Suspense fallback={null}>
          <SiteConsent
            storeId={store.id}
            tracking={store.tracking}
            code={liveCustomCode(store.customCode)}
            lang={market.lang}
            locale={market.locale}
            cookiePage={marketPath(store.slug, market.slug, "/cookies")}
          />
        </Suspense>
      </body>
    </html>
  );
}
