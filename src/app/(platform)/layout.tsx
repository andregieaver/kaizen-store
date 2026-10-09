import type { Metadata } from "next";
import { Suspense } from "react";

import { SiteConsent } from "@/components/consent/site-consent";
import { CustomCss } from "@/components/custom-css";
import { FontLinks } from "@/components/font-links";
import { BreakpointSheet } from "@/components/part-styles";
import { DEFAULT_BREAKPOINTS } from "@/lib/breakpoints";
import { PlatformBottomBar, PlatformFooter, PlatformHeader, PlatformMenu } from "@/components/platform-layout";
import { KaizenChat } from "@/components/site-chat";
import { KaizenSiteFooter, KaizenSiteHeader } from "@/components/site-parts";
import { t } from "@/lib/i18n";
import { siteFontFamilies } from "@/lib/fonts";
import { siteUrl } from "@/lib/site";
import { siteIcons } from "@/lib/site-icons";
import { siteFontStyle } from "@/server/fonts";
import { getPlatformChrome, getPlatformFavicon } from "@/server/platform-navigation";
import { getPlatformSeo, PLATFORM_DEFAULTS, verificationTags } from "@/server/seo";
import { siteLayoutFor } from "@/server/site-layouts";

import "../globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const [seo, favicon] = await Promise.all([getPlatformSeo(), getPlatformFavicon()]);
  const title = seo.title.en || PLATFORM_DEFAULTS.title;
  const description = seo.description.en || PLATFORM_DEFAULTS.description;
  const image = seo.image
    ? { url: seo.image.url, alt: seo.image.alt.en || title }
    : { url: "/og.png", alt: title, width: 1200, height: 630 };
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s · ${title}` },
    description,
    openGraph: { type: "website", siteName: title, locale: "en_GB", title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    verification: verificationTags(seo),
    icons: siteIcons(favicon),
  };
}

/** Kaizen's own pages, with its header and footer (D42), built like a store's. */
export default async function PlatformLayout({ children }: LayoutProps<"/">) {
  // Kaizen's own header and footer built in the page builder (D80), else the standard ones.
  const [chrome, headerLayout, footerLayout] = await Promise.all([getPlatformChrome(), siteLayoutFor(null, "header"), siteLayoutFor(null, "footer")]);
  return (
    <html lang="en" className="h-full antialiased">
      {/* On phones the bottom bar covers the last 4rem, so the page ends above it. */}
      <body
        className="flex min-h-full flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] font-sans md:pb-0"
        style={siteFontStyle(chrome.fonts)}
      >
        {/* Kaizen's own fonts, from its copies (D59). */}
        <FontLinks families={siteFontFamilies(chrome.fonts)} />
        {/* Kaizen's screen sizes are the defaults (D179): the breakpoint classes of what is drawn outside rows. */}
        <BreakpointSheet breakpoints={DEFAULT_BREAKPOINTS} />
        {/* Kaizen's own CSS for every page, and its header's and footer's (D100). */}
        <CustomCss css={chrome.customCss} name="kaizen" />
        <CustomCss css={headerLayout?.content.css} name={`header-${headerLayout?.id}`} />
        <CustomCss css={footerLayout?.content.css} name={`footer-${footerLayout?.id}`} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-background focus:p-2"
        >
          {t("en").skipToContent}
        </a>
        {headerLayout ? <KaizenSiteHeader chrome={chrome} layout={headerLayout} /> : <PlatformHeader chrome={chrome} />}
        {/* A footer revealed on scroll (D184) lies under the page, which covers it. */}
        {footerLayout?.content.footerReveal ? <div className="relative z-10 bg-background">{children}</div> : children}
        {footerLayout ? <KaizenSiteFooter chrome={chrome} layout={footerLayout} /> : <PlatformFooter chrome={chrome} />}
        {/* Phone enhancements, each in its own boundary, as in the storefront (D30). */}
        <Suspense fallback={null}>
          <PlatformBottomBar />
        </Suspense>
        <Suspense fallback={null}>
          <PlatformMenu chrome={chrome} />
        </Suspense>
        {/* Kaizen's AI assistant (D81), while it is on. */}
        <Suspense fallback={null}>
          <KaizenChat />
        </Suspense>
        {/* Asks about Kaizen's optional tools, if it has any (D58). */}
        <Suspense fallback={null}>
          <SiteConsent storeId={null} tracking={chrome.tracking} lang="en" locale="en-GB" cookiePage="/cookies" />
        </Suspense>
      </body>
    </html>
  );
}
