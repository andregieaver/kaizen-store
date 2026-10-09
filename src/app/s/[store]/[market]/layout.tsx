import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";

import { BackToAdmin } from "@/components/back-to-admin";
import { AbMarker } from "@/components/ab/ab-marker";
import { StoreExperiments } from "@/components/ab/store-experiments";
import { OffPayRoutes } from "@/components/off-pay-routes";
import { PayDocumentWatcher } from "@/components/pay-route-guard";
import { StoreVisits } from "@/components/store-visits";
import { StoreSiteFooter, StoreSiteHeader } from "@/components/site-parts";
import { StoreBottomBar, StoreFooter, StoreHeader, StoreMenu, WithdrawalStrip } from "@/components/store-layout";
import { CustomCss } from "@/components/custom-css";
import { StoreColorScript } from "@/components/store-color-switch";
import { UiTexts } from "@/components/ui-texts";
import { StoreThemeStyles } from "@/components/store-theme";
import { buyerScript } from "@/lib/b2b";
import { t } from "@/lib/i18n";
import { languageChoices } from "@/lib/localization";
import { inView } from "@/lib/markets";
import { looksLikeMarket } from "@/lib/redirect-path";
import { adminOrigin, marketHome, storeHome, storeSiteUrl } from "@/lib/paths";
import { siteIcons } from "@/lib/site-icons";
import { footerHasWithdrawal } from "@/lib/site-layout";
import { featureOn, showsWithdrawalLink } from "@/lib/store-features";
import { themeAttributes } from "@/lib/theme";
import { afterSaleOpenCached } from "@/server/after-sale";
import { siteFontStyle } from "@/server/fonts";
import { storeShareImage, storeShareTags, verificationTags } from "@/server/seo";
import { prerenderedShops, resolveAfterSaleShop, resolveShop } from "@/server/shop";
import { legalLinksFor } from "@/server/legal-links";
import { siteLayoutForVisitor } from "@/server/site-layouts";
import { uiTextsFor } from "@/server/ui-text";

import { MarketExtras } from "./extras";
import { legacyLocation } from "./legacy-redirect";

import "../../../globals.css";

type Props = LayoutProps<"/s/[store]/[market]">;

export function generateStaticParams() {
  return prerenderedShops();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) {
    // A country, language or currency no longer offered (D178): only what was bought opens here, never for search engines.
    const kept = await resolveAfterSaleShop(storeSlug, marketSlug);
    return kept ? { title: { default: kept.store.name, template: `%s · ${kept.store.name}` }, robots: { index: false }, icons: siteIcons(kept.store.navigation.favicon) } : {};
  }
  const { store, market, ab } = shop;
  const title = store.seo.title[market.locale] || store.name;
  const description =
    store.seo.description[market.locale] || t(market.lang).storeSummary(store.name, market.name);
  const home = marketHome(store.slug, market.slug);
  // The same page in another currency is the same page: its address is the one in the country's own (D109).
  const canonical = marketHome(store.slug, inView(market, { currency: market.nativeCurrency }).slug);
  return {
    metadataBase: new URL(storeSiteUrl(store.slug)),
    title: { default: title, template: `%s · ${store.name}` },
    description,
    // A store is not for search engines until its owner opens it, or while they hide it; a store template (D175) never is.
    // A version of the header, footer or product layout under an A/B test (D148) is never a page of its own for search engines.
    ...(!(store.setupCompletedAt || store.isTemplate) || store.starter || store.seo.hidden || Object.keys(ab).length > 0 ? { robots: { index: false } } : {}),
    alternates: {
      canonical,
      languages: {
        // Every country offered in every language a shopper can see it in (D109; D178: its own only with Several languages off).
        ...Object.fromEntries(
          store.markets.flatMap((m) =>
            languageChoices(store.localization, m).map((locale) => [
              `${locale.split("-")[0]}-${m.code}`,
              marketHome(store.slug, inView(m, { locale, currency: m.nativeCurrency }).slug),
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
  // A country, language or currency the store no longer offers (D178) is still drawn here: its page moves to one offered (`marketMoved()`), or,
  // for what a shopper already bought (an order, a withdrawal, a document), opens as it was bought (`resolveAfterSaleShop()`).
  const shop = (await resolveShop(storeSlug, marketSlug)) ?? (await resolveAfterSaleShop(storeSlug, marketSlug));
  if (!shop) {
    // A first part that only looks like a market (`/om-oss`, an old shop's page) may be a manual redirect's source (wave 2, D168); the proxy leaves it to this layout.
    const moved = looksLikeMarket(marketSlug) ? await legacyLocation(storeSlug, marketSlug) : null;
    if (moved) permanentRedirect(moved);
    notFound();
  }
  const { store, market, ab } = shop;
  const m = t(market.lang);
  // A website (D178 step 5: the online shop off) keeps the withdrawal link, and the checkout's legal pages, while an order can still be
  // withdrawn from or returned (asked only of a website, cached for an hour).
  const selling = featureOn(store, "shop");
  const afterSale = selling || (await afterSaleOpenCached(store.id));
  const withdrawal = showsWithdrawalLink(store, afterSale);
  // The store's own header and footer built in the page builder (D80), else the standard ones; the visitor's version of them while one is under an A/B test (D148).
  const [header, footer, legalLinks] = await Promise.all([
    siteLayoutForVisitor(store.id, "header", ab),
    siteLayoutForVisitor(store.id, "footer", ab),
    // The published legal pages, listed in the standard footer (wave 1, 1e), as far as the store needs them (D178 step 5).
    legalLinksFor(store, market, afterSale),
  ]);
  const headerLayout = header.layout;
  const footerLayout = footer.layout;
  const uiTexts = uiTextsFor(market.lang);
  // A store template (D175) says only that it is one: a preview that takes no orders.
  // A website (D178 step 5) takes no payments, so nothing is said about them.
  const notice = store.starter
    ? m.starterNotice
    : [
      !(store.setupCompletedAt || store.isTemplate) && m.previewNotice,
      selling && !store.paymentsOn && (store.setupCompletedAt || store.isTemplate) && m.demoNotice,
      selling && store.paymentsOn && store.paymentsTest && m.testNotice,
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
          <StoreSiteHeader store={store} market={market} notice={notice} layout={headerLayout} withdrawal={withdrawal} />
        ) : (
          <StoreHeader store={store} market={market} notice={notice} />
        )}
        {/* A store's page (D54) spans the window: its rows keep to this width themselves. */}
        <main
          id="main"
          // A footer revealed on scroll (D184) lies under the page, which covers it.
          className={`mx-auto w-full max-w-(--content-width) flex-1 px-4 py-8 has-[>.store-page]:max-w-none has-[>.store-page]:p-0 ${
            footerLayout?.content.footerReveal ? "relative z-10 bg-background" : ""
          }`}
        >
          {children}
        </main>
        {footerLayout ? (
          <StoreSiteFooter store={store} market={market} layout={footerLayout} withdrawal={withdrawal} />
        ) : (
          <StoreFooter store={store} market={market} legal={legalLinks} withdrawal={withdrawal} />
        )}
        {/* The withdrawal function is always reachable (D153): a footer of the store's own without its link gets the standard one. */}
        {withdrawal && footerLayout && !footerHasWithdrawal(footerLayout.content) && <WithdrawalStrip store={store} market={market} />}
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
        {/*
          What other sites' code can come in through (wave 1, 1e): the store's assistant, referral capture, the business popup, and the
          consent banner with the tracking tools and the owner's own code it loads. Not drawn on the cart, checkout and order, where a
          shopper types a card (`docs/pci.md`); everywhere else they stay as they were across navigations.
        */}
        <Suspense fallback={null}>
          <OffPayRoutes>
            <MarketExtras store={store} market={market} />
          </OffPayRoutes>
        </Suspense>
        <BackToAdmin storeSlug={store.slug} adminOrigin={adminOrigin(store.slug)} />
        {/* Notes when this document has left the pay routes, so the cart, checkout and order load afresh (wave 1, 1e). */}
        <Suspense fallback={null}>
          <PayDocumentWatcher />
        </Suspense>
        {/* Cookieless visit counting (D152), while the owner has it on; the beacon reads the path, so it sits in a boundary. */}
        <Suspense fallback={null}>
          <StoreVisits store={store} />
        </Suspense>
        {/* A test of the header or the footer (D148): which version this page has, for the exposure. */}
        {[header, footer].map(
          (drawn, index) =>
            drawn.test && (
              <AbMarker
                key={index}
                storeId={store.id}
                store={store.slug}
                market={market.slug}
                experiment={drawn.test.id}
                variant={drawn.version}
                goalBlock={drawn.test.goalBlock}
              />
            ),
        )}
        {/* A/B tests of the store's pages (D148): a visitor's versions, once they have accepted statistics cookies. */}
        <Suspense fallback={null}>
          <StoreExperiments storeId={store.id} store={store.slug} market={market.slug} />
        </Suspense>
      </body>
    </html>
  );
}
