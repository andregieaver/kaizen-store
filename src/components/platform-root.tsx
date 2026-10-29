import { FooterRevealGuard } from "@/components/footer-reveal";
import { KeepFocusEverywhere } from "@/components/keep-focus-everywhere";
import { SpeedBeacon } from "@/components/speed-beacon";
import type { Metadata } from "next";
import { Suspense } from "react";

import { SiteConsent } from "@/components/consent/site-consent";
import { CustomCss } from "@/components/custom-css";
import { StoreThemeStyles } from "@/components/store-theme";
import { themeAttributes } from "@/lib/theme";
import { PlatformBottomBar, PlatformFooter, PlatformHeader, PlatformMenu } from "@/components/platform-layout";
import { OffPayRoutes } from "@/components/off-pay-routes";
import { KaizenChat } from "@/components/site-chat";
import { LanguageHint, LanguageSwitch } from "@/components/language-switch";
import { KaizenSiteFooter, KaizenSiteHeader } from "@/components/site-parts";
import { t } from "@/lib/i18n";
import { PLATFORM_LANG_FACTS, platformPath, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { siteUrl } from "@/lib/site";
import { siteIcons } from "@/lib/site-icons";
import { siteFontStyle } from "@/server/fonts";
import { getPlatformChrome, getPlatformFavicon } from "@/server/platform-navigation";
import { getPlatformSeo, PLATFORM_DEFAULTS, verificationTags } from "@/server/seo";
import { siteLayoutFor } from "@/server/site-layouts";


/**
 * Kaizena Flow's own site in one of its languages (D312): the root of `(platform)` (English, at the addresses it always had) and of
 * `(platform-nb)` (Norwegian, under `/no`). Its search texts are the language's where written, else English.
 */
export async function platformRootMetadata(lang: PlatformLang): Promise<Metadata> {
  const [seo, favicon] = await Promise.all([getPlatformSeo(), getPlatformFavicon()]);
  const own = (texts: Record<string, string>) => texts[lang] || texts.en;
  const title = own(seo.title) || PLATFORM_DEFAULTS.title;
  // A language the owner wrote no description in takes the site's own words in it, never the English description.
  const description = lang === "en" ? own(seo.description) || PLATFORM_DEFAULTS.description : seo.description[lang] || platformText(lang).site.description;
  const image = seo.image
    ? { url: seo.image.url, alt: own(seo.image.alt) || title }
    : { url: "/og.png", alt: title, width: 1200, height: 630 };
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s · ${title}` },
    description,
    openGraph: { type: "website", siteName: title, locale: PLATFORM_LANG_FACTS[lang].ogLocale, title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    verification: verificationTags(seo),
    icons: siteIcons(favicon),
  };
}

/** Kaizen's own pages, with its header and footer (D42), built like a store's, in the language `lang` (D312). */
export async function PlatformRoot({ lang, children }: { lang: PlatformLang; children: React.ReactNode }) {
  const facts = PLATFORM_LANG_FACTS[lang];
  // Kaizen's own header and footer built in the page builder (D80), else the standard ones.
  const [chrome, headerLayout, footerLayout] = await Promise.all([getPlatformChrome(), siteLayoutFor(null, "header"), siteLayoutFor(null, "footer")]);
  return (
    // Kaizen's own theme (D235): its choices as attributes, its colours and sizes as variables, as a store's (D60).
    <html lang={facts.tag} className="h-full antialiased" {...themeAttributes(chrome.theme.settings)} suppressHydrationWarning={chrome.theme.settings.visitorSwitch}>
      {/* On phones the bottom bar covers the last 4rem, so the page ends above it. */}
      <body
        className="flex min-h-full flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] font-sans md:pb-0"
        style={siteFontStyle(chrome.fonts)}
      >
        {/* Kaizen's own fonts, from its copies (D59), its theme (D235) and its screen sizes' breakpoint classes (D179). */}
        <StoreThemeStyles store={{ id: "kaizen", theme: chrome.theme, fonts: chrome.fonts }} />
        {/* Kaizen's own CSS for every page, and its header's and footer's (D100). */}
        <CustomCss css={chrome.customCss} name="kaizen" />
        <CustomCss css={headerLayout?.content.css} name={`header-${headerLayout?.id}`} />
        <CustomCss css={footerLayout?.content.css} name={`footer-${footerLayout?.id}`} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-background focus:p-2"
        >
          {t(facts.messages).skipToContent}
        </a>
        {/* The page in the browser's own language, suggested once (D312); never a redirect. */}
        {chrome.langs.length > 1 && (
          <Suspense fallback={null}>
            <LanguageHint lang={lang} offered={chrome.langs} />
          </Suspense>
        )}
        {headerLayout ? <KaizenSiteHeader chrome={chrome} layout={headerLayout} lang={lang} /> : <PlatformHeader chrome={chrome} lang={lang} />}
        {/* A footer revealed on scroll (D184) lies under the page, which covers it. */}
        {footerLayout?.content.footerReveal ? <div className="over-footer relative z-10 bg-background">{children}</div> : children}
        {footerLayout?.content.footerReveal && <FooterRevealGuard />}
        {/* A button disabled while it sends gets the focus back when done (D390, ACC-02). */}
        <KeepFocusEverywhere />
        {/* How fast Kaizena Flow's own pages are for their visitors (D390), as a store's (D336), never on a pay route (it has none). */}
        <SpeedBeacon own="platform" />
        {footerLayout ? <KaizenSiteFooter chrome={chrome} layout={footerLayout} lang={lang} /> : <PlatformFooter chrome={chrome} lang={lang} />}
        {chrome.langs.length > 1 && (
          <Suspense fallback={null}>
            <LanguageSwitch lang={lang} offered={chrome.langs} />
          </Suspense>
        )}
        {/* Phone enhancements, each in its own boundary, as in the storefront (D30). */}
        <Suspense fallback={null}>
          <PlatformBottomBar lang={lang} />
        </Suspense>
        <Suspense fallback={null}>
          <PlatformMenu chrome={chrome} lang={lang} />
        </Suspense>
        {/* Kaizen's chat (D81, D216) and the consent banner (D58), never on a support conversation's email link, whose address holds its token. */}
        <Suspense fallback={null}>
          <OffPayRoutes>
            <Suspense fallback={null}>
              <KaizenChat lang={lang} />
            </Suspense>
            <Suspense fallback={null}>
              <SiteConsent storeId={null} tracking={chrome.tracking} lang={facts.messages} locale={facts.locale} cookiePage={platformPath(lang, "/cookies")} />
            </Suspense>
          </OffPayRoutes>
        </Suspense>
      </body>
    </html>
  );
}
