import type { Metadata } from "next";

import { JsonLdScript } from "@/components/json-ld";
import { PageArticle, pageRoomClass } from "@/components/page-article";
import { PageEditLink } from "@/components/page-edit-link";
import { HeaderOverlayMark } from "@/components/store-chrome";
import { pageExcerpt } from "@/lib/page-content";
import { headerOverlays } from "@/lib/site-layout";
import { siteUrl } from "@/lib/site";
import { pageJsonLd } from "@/lib/structured-data";
import type { PublishedPage } from "@/server/pages";
import { PLATFORM_DEFAULTS } from "@/server/seo";
import { siteLayoutFor } from "@/server/site-layouts";

/**
 * One of Kaizen's published pages as the site shows it (D42): at its own address, or, chosen for a place of its own
 * (D143), as its front page, blog or 404 page, which it then draws at the place's address.
 */

/** The page's own search and sharing texts, over Kaizen's; `url` is the address it is shown at. */
export function platformPageMetadata(page: PublishedPage, url: string): Metadata {
  const c = page.content;
  const title = c.seo.title || c.title;
  const description = c.seo.description || pageExcerpt(c) || PLATFORM_DEFAULTS.description;
  const images = c.thumbnail
    ? [{ url: c.thumbnail.url, alt: c.thumbnail.alt || c.title, width: c.thumbnail.width, height: c.thumbnail.height }]
    : [{ url: "/og.png", alt: "Kaizen", width: 1200, height: 630 }];
  return {
    // The page's own search title is used as written; otherwise "Title · Kaizen".
    title: c.seo.title ? { absolute: c.seo.title } : c.title,
    description,
    alternates: { canonical: url },
    ...(!c.searchEngines && { robots: { index: false } }),
    openGraph: { type: "article", siteName: "Kaizen", locale: "en_GB", url, title, description, images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export async function PlatformPageView({
  page,
  url,
  front = false,
  query,
}: {
  page: PublishedPage;
  url: string;
  front?: boolean;
  /** The address's parameters, read only by a part shown by conditions (D179 phase 4). */
  query?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const c = page.content;
  const origin = siteUrl();
  // Kaizen's header may lie over its pages (D80), over a front page's first row too.
  const header = await siteLayoutFor(null, "header");
  const over = headerOverlays(header?.content.overlay, { front, categories: c.categories, tags: c.tags, rows: c.rows });
  return (
    <main id="main" className={`w-full flex-1 ${pageRoomClass(c, "pt-10", "pb-10")}`} data-header-overlay={over ? "" : undefined}>
      {over && <HeaderOverlayMark />}
      <JsonLdScript
        data={pageJsonLd({
          origin,
          url: `${origin}${url}`,
          title: c.title,
          description: c.seo.description || pageExcerpt(c),
          image: c.thumbnail?.url ?? null,
          publishedAt: page.publishedAt,
        })}
      />
      <PageArticle content={c} place={{ pageId: page.id, owner: null, query }} editable />
      <PageEditLink pageId={page.id} />
    </main>
  );
}
