import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { ArticleView } from "@/components/article-view";
import { JsonLdScript } from "@/components/json-ld";
import { PageEditLink } from "@/components/page-edit-link";
import { PlatformPageView, platformPageMetadata } from "@/components/platform-page";
import { pageExcerpt, pageSlugProblem, reservedPageSlugs } from "@/lib/page-content";
import { PLATFORM_LANG_FACTS, platformPath, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { siteUrl } from "@/lib/site";
import { articleJsonLd } from "@/lib/structured-data";
import { findPublishedPage, listPublishedPages } from "@/server/pages";
import { languageMeta } from "@/server/platform-lang-meta";
import { platformPageForRole } from "@/server/platform-roles";
import { PLATFORM_DEFAULTS } from "@/server/seo";

import { BlogIndex } from "./terms";

type Query = Promise<Record<string, string | string[] | undefined>>;

/** Kaizen's own blog page's search and sharing texts where one is chosen (D143), in `lang` (D312). */
export async function blogMetadata(lang: PlatformLang): Promise<Metadata> {
  const [page, meta] = await Promise.all([platformPageForRole("blog"), languageMeta(lang, "/blog")]);
  if (page) return platformPageMetadata(page, "/blog", { lang, languages: meta.languages });
  return {
    title: platformText(lang).blog.title,
    description: platformText(lang).blog.description,
    alternates: meta,
  };
}

/** Kaizen's blog (D57): one of its own pages where one is chosen (D143), else its articles, newest first. */
export async function BlogRoute({ lang, searchParams }: { lang: PlatformLang; searchParams: Query }) {
  const page = await platformPageForRole("blog");
  if (page) return <PlatformPageView page={page} url="/blog" query={searchParams} lang={lang} />;
  return <BlogIndex lang={lang} />;
}

/**
 * Kaizen's articles (D57), prerendered when the site is built so their content is plain HTML; articles published later are rendered on
 * first visit and then cached until the next change.
 */
export async function articleStaticParams() {
  const articles = await listPublishedPages(null, "article");
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return articles.length > 0 ? articles.map((article) => ({ slug: article.slug })) : [{ slug: "_" }];
}

async function loadArticle(slug: string) {
  return pageSlugProblem(slug, reservedPageSlugs(null, "article")) === null ? findPublishedPage(null, slug, "article") : null;
}

export async function articleMetadata(lang: PlatformLang, slug: string): Promise<Metadata> {
  const found = await loadArticle(slug);
  if (!found || "redirect" in found) return {};
  const { page } = found;
  const c = page.content;
  const title = c.seo.title || c.title;
  const description = c.seo.description || pageExcerpt(c) || PLATFORM_DEFAULTS.description;
  const meta = await languageMeta(lang, `/blog/${page.slug}`);
  const images = c.thumbnail
    ? [{ url: c.thumbnail.url, alt: c.thumbnail.alt || c.title, width: c.thumbnail.width, height: c.thumbnail.height }]
    : [{ url: "/og.png", alt: "Kaizena Flow", width: 1200, height: 630 }];
  return {
    title: c.seo.title ? { absolute: c.seo.title } : c.title,
    description,
    alternates: meta,
    ...(!c.searchEngines && { robots: { index: false } }),
    openGraph: {
      type: "article",
      siteName: "Kaizena Flow",
      locale: PLATFORM_LANG_FACTS[lang].ogLocale,
      url: meta.canonical,
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

export async function ArticleRoute({ lang, slug }: { lang: PlatformLang; slug: string }) {
  const found = await loadArticle(slug);
  if (!found) notFound();
  // An article that moved: its old address leads to the new one for good.
  if ("redirect" in found) permanentRedirect(platformPath(lang, `/blog/${found.redirect}`));
  const { page } = found;
  const c = page.content;
  const origin = siteUrl();
  const facts = PLATFORM_LANG_FACTS[lang];

  return (
    <main id="main" className="w-full flex-1 py-10">
      <JsonLdScript
        data={articleJsonLd({
          origin,
          url: `${origin}${platformPath(lang, `/blog/${page.slug}`)}`,
          title: c.title,
          description: c.seo.description || pageExcerpt(c),
          image: c.thumbnail?.url ?? null,
          publishedAt: page.firstPublishedAt,
          modifiedAt: page.publishedAt,
          author: c.author || null,
          locale: facts.messages,
        })}
      />
      <ArticleView
        content={c}
        date={page.firstPublishedAt}
        byline={c.author || "Kaizena Flow"}
        lang={facts.messages}
        locale={facts.locale}
        place={{ pageId: page.id, owner: null, lang }}
        editable
      />
      <PageEditLink pageId={page.id} article />
    </main>
  );
}
