import type { Metadata } from "next";

import { siteUrl } from "@/lib/site";
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

export default function PlatformLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
