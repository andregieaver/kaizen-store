import type { Metadata } from "next";
import { Suspense } from "react";

import { SiteConsent } from "@/components/consent/site-consent";
import { FontLinks } from "@/components/font-links";
import { PlatformBottomBar, PlatformFooter, PlatformHeader, PlatformMenu } from "@/components/platform-layout";
import { t } from "@/lib/i18n";
import { siteFontFamilies } from "@/lib/fonts";
import { siteUrl } from "@/lib/site";
import { siteFontStyle } from "@/server/fonts";
import { getPlatformChrome } from "@/server/platform-navigation";
import { getPlatformSeo, PLATFORM_DEFAULTS, verificationTags } from "@/server/seo";

import "../globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPlatformSeo();
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
  };
}

/** Kaizen's own pages, with its header and footer (D42), built like a store's. */
export default async function PlatformLayout({ children }: LayoutProps<"/">) {
  const chrome = await getPlatformChrome();
  return (
    <html lang="en" className="h-full antialiased">
      {/* On phones the bottom bar covers the last 4rem, so the page ends above it. */}
      <body
        className="flex min-h-full flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] font-sans md:pb-0"
        style={siteFontStyle(chrome.fonts)}
      >
        {/* Kaizen's own fonts, from its copies (D59). */}
        <FontLinks families={siteFontFamilies(chrome.fonts)} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-background focus:p-2"
        >
          {t("en").skipToContent}
        </a>
        <PlatformHeader chrome={chrome} />
        {children}
        <PlatformFooter chrome={chrome} />
        {/* Phone enhancements, each in its own boundary, as in the storefront (D30). */}
        <Suspense fallback={null}>
          <PlatformBottomBar />
        </Suspense>
        <Suspense fallback={null}>
          <PlatformMenu chrome={chrome} />
        </Suspense>
        {/* Asks about Kaizen's optional tools, if it has any (D58). */}
        <Suspense fallback={null}>
          <SiteConsent storeId={null} tracking={chrome.tracking} lang="en" locale="en-GB" cookiePage="/cookies" />
        </Suspense>
      </body>
    </html>
  );
}
