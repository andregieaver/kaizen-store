import type { Metadata } from "next";

import { JsonLdScript } from "@/components/json-ld";
import { PageArticle, pageRoomClass } from "@/components/page-article";
import { PageEditLink } from "@/components/page-edit-link";
import { HeaderOverlayMark } from "@/components/store-chrome";
import { pageExcerpt } from "@/lib/page-content";
import { headerOverlays } from "@/lib/site-layout";
import { PLATFORM_LANG_FACTS, platformPath, type PlatformLang } from "@/lib/platform-lang";
import { siteUrl } from "@/lib/site";
import { pageJsonLd } from "@/lib/structured-data";
import type { ThemeStorePart } from "@/lib/theme-store-parts";
import type { PublishedPage } from "@/server/pages";
import { PLATFORM_DEFAULTS } from "@/server/seo";
import { siteLayoutFor } from "@/server/site-layouts";

/**
 * One of Kaizen's published pages as the site shows it (D42): at its own address, or, chosen for a place of its own
 * (D143), as its front page, blog or 404 page, or the theme store's list or a theme's page (D285), which it then draws at the
 * place's address.
 */

/**
 * The page's own search and sharing texts, over Kaizen's; `url` is its English address (D312: the address in `lang` is the canonical one,
 * and `languages` its addresses in the site's languages, from `languageMeta()`).
 */
export function platformPageMetadata(page: PublishedPage, url: string, { lang = "en", languages }: { lang?: PlatformLang; languages?: Record<string, string> } = {}): Metadata {
  const c = page.content;
  const title = c.seo.title || c.title;
  const description = c.seo.description || pageExcerpt(c) || PLATFORM_DEFAULTS.description;
  const images = c.thumbnail
    ? [{ url: c.thumbnail.url, alt: c.thumbnail.alt || c.title, width: c.thumbnail.width, height: c.thumbnail.height }]
    : [{ url: "/og.png", alt: "Kaizena Flow", width: 1200, height: 630 }];
  return {
    // The page's own search title is used as written; otherwise "Title · Kaizen".
    title: c.seo.title ? { absolute: c.seo.title } : c.title,
    description,
    alternates: { canonical: platformPath(lang, url), ...(languages && { languages }) },
    ...(!c.searchEngines && { robots: { index: false } }),
    openGraph: { type: "article", siteName: "Kaizena Flow", locale: PLATFORM_LANG_FACTS[lang].ogLocale, url: platformPath(lang, url), title, description, images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export async function PlatformPageView({
  page,
  url,
  front = false,
  query,
  themeSlug,
  themeParts,
  jsonLd = true,
  lang = "en",
}: {
  page: PublishedPage;
  /** The language the site is drawn in (D312); `url` stays the English address. */
  lang?: PlatformLang;
  url: string;
  front?: boolean;
  /** The address's parameters, read only by a part shown by conditions (D179 phase 4). */
  query?: Promise<Record<string, string | string[] | undefined>>;
  /** On the page chosen for a theme's page (D285): the theme the address names, which its theme store components draw. */
  themeSlug?: string;
  /** With it, the parts that have something for that theme (`themePartsWith()`). */
  themeParts?: readonly ThemeStorePart[];
  /** The page's own structured data; off where the route writes its own (a theme's page describes the theme). */
  jsonLd?: boolean;
}) {
  const c = page.content;
  const origin = siteUrl();
  // Kaizen's header may lie over its pages (D80), over a front page's first row too.
  const header = await siteLayoutFor(null, "header");
  const over = headerOverlays(header?.content.overlay, { front, categories: c.categories, tags: c.tags, rows: c.rows });
  return (
    <main id="main" className={`w-full flex-1 ${pageRoomClass(c, "pt-10", "pb-10")}`} data-header-overlay={over ? "" : undefined}>
      {over && <HeaderOverlayMark />}
      {jsonLd && (
        <JsonLdScript
          data={pageJsonLd({
            origin,
            url: `${origin}${platformPath(lang, url)}`,
            title: c.title,
            description: c.seo.description || pageExcerpt(c),
            image: c.thumbnail?.url ?? null,
            publishedAt: page.publishedAt,
          })}
        />
      )}
      <PageArticle content={c} place={{ pageId: page.id, owner: null, query, lang, ...(themeSlug && { themeSlug, themeParts }) }} editable />
      <PageEditLink pageId={page.id} />
    </main>
  );
}
