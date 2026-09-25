import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { JsonLdScript } from "@/components/json-ld";
import { PageArticle } from "@/components/page-article";
import { PageEditLink } from "@/components/page-edit-link";
import { pageExcerpt, pageSlugProblem } from "@/lib/page-content";
import { siteUrl } from "@/lib/site";
import { pageJsonLd } from "@/lib/structured-data";
import { findPublishedPage, listPublishedPages } from "@/server/pages";
import { PLATFORM_DEFAULTS } from "@/server/seo";

type Props = PageProps<"/[slug]">;

/**
 * Kaizen's own pages (D42), prerendered when the site is built so their
 * content is plain HTML; pages published later are rendered on first visit
 * and then cached until the next change.
 */
export async function generateStaticParams() {
  const pages = await listPublishedPages();
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return pages.length > 0 ? pages.map((page) => ({ slug: page.slug })) : [{ slug: "_" }];
}

async function load(params: Props["params"]) {
  const { slug } = await params;
  return pageSlugProblem(slug) === null ? findPublishedPage(null, slug) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load(params);
  if (!found || "redirect" in found) return {};
  const { page } = found;
  const c = page.content;
  const title = c.seo.title || c.title;
  const description = c.seo.description || pageExcerpt(c) || PLATFORM_DEFAULTS.description;
  const url = `/${page.slug}`;
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

export default async function PlatformPage({ params }: Props) {
  const found = await load(params);
  if (!found) notFound();
  // A page that moved: its old address leads to the new one for good.
  if ("redirect" in found) permanentRedirect(`/${found.redirect}`);
  const { page } = found;
  const c = page.content;
  const origin = siteUrl();

  return (
    <main id="main" className="w-full flex-1 py-10">
      <JsonLdScript
        data={pageJsonLd({
          origin,
          url: `${origin}/${page.slug}`,
          title: c.title,
          description: c.seo.description || pageExcerpt(c),
          image: c.thumbnail?.url ?? null,
          publishedAt: page.publishedAt,
        })}
      />
      <PageArticle content={c} place={{ pageId: page.id, owner: null }} />
      <PageEditLink pageId={page.id} />
    </main>
  );
}
