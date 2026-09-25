import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { ArticleView } from "@/components/article-view";
import { JsonLdScript } from "@/components/json-ld";
import { PageEditLink } from "@/components/page-edit-link";
import { pageExcerpt, pageSlugProblem, reservedPageSlugs } from "@/lib/page-content";
import { siteUrl } from "@/lib/site";
import { articleJsonLd } from "@/lib/structured-data";
import { findPublishedPage, listPublishedPages } from "@/server/pages";
import { PLATFORM_DEFAULTS } from "@/server/seo";

type Props = PageProps<"/blog/[slug]">;

/**
 * Kaizen's articles (D57), prerendered when the site is built so their
 * content is plain HTML; articles published later are rendered on first
 * visit and then cached until the next change.
 */
export async function generateStaticParams() {
  const articles = await listPublishedPages(null, "article");
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return articles.length > 0 ? articles.map((article) => ({ slug: article.slug })) : [{ slug: "_" }];
}

async function load(params: Props["params"]) {
  const { slug } = await params;
  return pageSlugProblem(slug, reservedPageSlugs(null, "article")) === null ? findPublishedPage(null, slug, "article") : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load(params);
  if (!found || "redirect" in found) return {};
  const { page } = found;
  const c = page.content;
  const title = c.seo.title || c.title;
  const description = c.seo.description || pageExcerpt(c) || PLATFORM_DEFAULTS.description;
  const url = `/blog/${page.slug}`;
  const images = c.thumbnail
    ? [{ url: c.thumbnail.url, alt: c.thumbnail.alt || c.title, width: c.thumbnail.width, height: c.thumbnail.height }]
    : [{ url: "/og.png", alt: "Kaizen", width: 1200, height: 630 }];
  return {
    title: c.seo.title ? { absolute: c.seo.title } : c.title,
    description,
    alternates: { canonical: url },
    ...(!c.searchEngines && { robots: { index: false } }),
    openGraph: {
      type: "article",
      siteName: "Kaizen",
      locale: "en_GB",
      url,
      title,
      description,
      images,
      publishedTime: page.firstPublishedAt,
      modifiedTime: page.publishedAt,
      ...(c.author && { authors: [c.author] }),
    },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export default async function ArticlePage({ params }: Props) {
  const found = await load(params);
  if (!found) notFound();
  // An article that moved: its old address leads to the new one for good.
  if ("redirect" in found) permanentRedirect(`/blog/${found.redirect}`);
  const { page } = found;
  const c = page.content;
  const origin = siteUrl();

  return (
    <main id="main" className="w-full flex-1 py-10">
      <JsonLdScript
        data={articleJsonLd({
          origin,
          url: `${origin}/blog/${page.slug}`,
          title: c.title,
          description: c.seo.description || pageExcerpt(c),
          image: c.thumbnail?.url ?? null,
          publishedAt: page.firstPublishedAt,
          modifiedAt: page.publishedAt,
          author: c.author || null,
          locale: "en",
        })}
      />
      <ArticleView
        content={c}
        date={page.firstPublishedAt}
        byline={c.author || "Kaizen"}
        lang="en"
        locale="en-GB"
        place={{ pageId: page.id, owner: null }}
      />
      <PageEditLink pageId={page.id} article />
    </main>
  );
}
