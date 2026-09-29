import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { BackToAdmin } from "@/components/back-to-admin";
import { BuyerQuestion } from "@/components/buyer";
import { SiteConsent } from "@/components/consent/site-consent";
import { StoreChat } from "@/components/site-chat";
import { StoreSiteFooter, StoreSiteHeader } from "@/components/site-parts";
import { StoreBottomBar, StoreFooter, StoreHeader, StoreMenu } from "@/components/store-layout";
import { CustomCss } from "@/components/custom-css";
import { StoreColorScript } from "@/components/store-color-switch";
import { UiTexts } from "@/components/ui-texts";
import { StoreThemeStyles } from "@/components/store-theme";
import { buyerScript } from "@/lib/b2b";
import { liveCustomCode } from "@/lib/custom-code";
import { t } from "@/lib/i18n";
import { inView } from "@/lib/markets";
import { adminOrigin, marketPath, storeHome, storeSiteUrl } from "@/lib/paths";
import { siteIcons } from "@/lib/site-icons";
import { themeAttributes } from "@/lib/theme";
import { siteFontStyle } from "@/server/fonts";
import { storeShareImage, storeShareTags, verificationTags } from "@/server/seo";
import { prerenderedShops, resolveShop } from "@/server/shop";
import { siteLayoutFor } from "@/server/site-layouts";
import { uiTextsFor } from "@/server/ui-text";

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
  // The same page in another currency is the same page: its address is the one in the country's own (D109).
  const canonical = marketPath(store.slug, inView(market, { currency: market.nativeCurrency }).slug);
  return {
    metadataBase: new URL(storeSiteUrl(store.slug)),
    title: { default: title, template: `%s · ${store.name}` },
    description,
    // A store is not for search engines until its owner opens it, or while they hide it.
    ...(!(store.setupCompletedAt || store.isTemplate) || store.seo.hidden ? { robots: { index: false } } : {}),
    alternates: {
      canonical,
      languages: {
        // Every country in every language the store is in (D109).
        ...Object.fromEntries(
          store.markets.flatMap((m) =>
            store.localization.locales.map((locale) => [
              `${locale.split("-")[0]}-${m.code}`,
              marketPath(store.slug, inView(m, { locale, currency: m.nativeCurrency }).slug),
            ]),
          ),
        ),
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

export default async function MarketLayout({ children, drawer, params }: Props) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);
  // The store's own header and footer built in the page builder (D80), else the standard ones.
  const [headerLayout, footerLayout] = await Promise.all([siteLayoutFor(store.id, "header"), siteLayoutFor(store.id, "footer")]);
  const uiTexts = uiTextsFor(market.lang);
  const notice =
    [
      !(store.setupCompletedAt || store.isTemplate) && m.previewNotice,
      !store.paymentsOn && (store.setupCompletedAt || store.isTemplate) && m.demoNotice,
      store.paymentsOn && store.paymentsTest && m.testNotice,
    ]
      .filter(Boolean)
      .join(" ") || null;

  return (
    // The store's theme (D60): its choices as attributes, its colours and sizes as variables.
    // Stores selling to businesses show their prices without VAT (B2B); selling to both, the first script marks the shopper's kind.
    <html
      lang={market.lang}
      className="h-full antialiased"
      {...themeAttributes(store.theme.settings)}
      data-buyer={store.audience === "businesses" ? "business" : undefined}
      suppressHydrationWarning={store.audience === "both" || store.theme.settings.visitorSwitch}
    >
      {/* On phones the bottom bar covers the last 4rem, so the page ends above it. */}
      <body
        className="flex min-h-full flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] font-sans md:pb-0"
        style={siteFontStyle(store.fonts)}
      >
        {/* The interface text of a language translated by AI (D111), for client components. */}
        <UiTexts lang={market.lang} texts={uiTexts} />
        {store.audience === "both" && <script dangerouslySetInnerHTML={{ __html: buyerScript(store.id) }} />}
        <StoreColorScript store={store} />
        {/* The store's own fonts (D59) and theme (D60). */}
        <StoreThemeStyles store={store} />
        {/* The owner's own CSS for every page, and the header's and footer's (D100), after the theme. */}
        <CustomCss css={store.customCss} name={`store-${store.id}`} />
        <CustomCss css={headerLayout?.content.css} name={`header-${headerLayout?.id}`} />
        <CustomCss css={footerLayout?.content.css} name={`footer-${footerLayout?.id}`} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-background focus:p-2"
        >
          {m.skipToContent}
        </a>
        {/* Shoppers are told when a store is a preview, cannot take payment yet, or takes test payments only. */}
        {headerLayout ? (
          <StoreSiteHeader store={store} market={market} notice={notice} layout={headerLayout} />
        ) : (
          <StoreHeader store={store} market={market} notice={notice} />
        )}
        {/* A store's page (D54) spans the window: its rows keep to this width themselves. */}
        <main
          id="main"
          className="mx-auto w-full max-w-(--content-width) flex-1 px-4 py-8 has-[>.store-page]:max-w-none has-[>.store-page]:p-0"
        >
          {children}
        </main>
        {footerLayout ? <StoreSiteFooter store={store} market={market} layout={footerLayout} /> : <StoreFooter store={store} market={market} />}
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
        {/* The slide-out cart on phones, when the cart is opened from a page of the store. */}
        {drawer}
        {store.businessPopup && <BuyerQuestion storeId={store.id} labels={m.buyer} />}
        {/* The store's AI assistant (D81), while it is on. */}
        <Suspense fallback={null}>
          <StoreChat store={store} market={market} />
        </Suspense>
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
