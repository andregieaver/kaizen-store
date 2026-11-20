import { pageExcerpt, type PageContent } from "./page-content";
import { pageImageUrls } from "./page-images";
import { remembersClose } from "./page-modal";
import { localizePage } from "./page-translation";

/**
 * What other pages, lists and files show of a page (bloat review step 2.14): the facts a publish compares, before and after, to decide
 * whether it refreshes only the page's own tag (`page:{id}`) or the store's pages tag (`pages:{store}`) as well. A grid's card, a blog's
 * list and feed, a menu link, the sitemaps, llms.txt, robots.txt and the cookie page read these; the body's other words and parts are
 * the page's own. When unsure whether another page shows a field, it belongs here: a field left out leaves a list stale until the next
 * site-wide refresh. `page-list-facts.test.ts` fails when the page index or a grid card gains a field this does not map.
 */
export type ListFacts = {
  title: string;
  /** The title in each language that has one of its own. */
  titles: Record<string, string>;
  slug: string;
  thumbnail: string | null;
  thumbnailAlt: string;
  /** The text a card or llms.txt shows: the excerpt; with neither excerpt nor search description, the start of the words. */
  excerpt: string;
  description: string;
  /** The excerpt, search description and picture description in each language the page is translated into. */
  excerpts: Record<string, string>;
  descriptions: Record<string, string>;
  thumbnailAlts: Record<string, string>;
  /** The pictures the sitemaps list for it (at most 10, its own picture first). */
  images: string[];
  categories: string[];
  tags: string[];
  markets: string[] | null;
  blogId: string | null;
  authorId: string | null;
  author: string | null;
  searchEngines: boolean;
  aiAssistants: boolean;
  /** It has a modal that opens by itself and remembers being closed (the cookie page lists it, D121). */
  rememberedModal: boolean;
};

/** The longest start of a page's words any list shows (a grid's card and a blog's feed: 300 characters). */
export const LIST_EXCERPT_MAX = 300;
/** As many pictures of a page as a sitemap lists. */
export const SITEMAP_IMAGES_MAX = 10;

/** A card's text: the excerpt; with neither excerpt nor search description, the start of the page's words. */
function excerptOf(content: PageContent): string {
  const excerpt = content.excerpt ?? "";
  if (excerpt || content.seo?.description) return excerpt;
  return pageExcerpt(content, LIST_EXCERPT_MAX);
}

export function listFacts(content: PageContent): ListFacts {
  const locales = Object.keys(content.translations ?? {}).sort();
  const titles: Record<string, string> = {};
  const excerpts: Record<string, string> = {};
  const descriptions: Record<string, string> = {};
  const thumbnailAlts: Record<string, string> = {};
  for (const locale of locales) {
    const own = content.translations?.[locale]?.title;
    if (typeof own === "string" && own.trim() !== "") titles[locale] = own;
    const localized = localizePage(content, locale);
    excerpts[locale] = excerptOf(localized);
    descriptions[locale] = localized.seo?.description ?? "";
    thumbnailAlts[locale] = localized.thumbnail?.alt ?? "";
  }
  return {
    title: content.title,
    titles,
    slug: content.slug,
    thumbnail: content.thumbnail?.url ?? null,
    thumbnailAlt: content.thumbnail?.alt ?? "",
    excerpt: excerptOf(content),
    description: content.seo?.description ?? "",
    excerpts,
    descriptions,
    thumbnailAlts,
    images: pageImageUrls(content).slice(0, SITEMAP_IMAGES_MAX),
    categories: [...(content.categories ?? [])].sort(),
    tags: [...(content.tags ?? [])].sort(),
    markets: content.markets ?? null,
    blogId: content.blogId ?? null,
    authorId: content.authorId ?? null,
    author: content.author ?? null,
    searchEngines: content.searchEngines ?? true,
    aiAssistants: content.aiAssistants ?? true,
    rememberedModal: content.rows.some((row) => row.modal !== undefined && remembersClose(row.modal)),
  };
}

/** The keys of ListFacts in their fixed order, so two facts compare by value whatever order they were built in. */
const KEYS: readonly (keyof ListFacts)[] = [
  "title",
  "titles",
  "slug",
  "thumbnail",
  "thumbnailAlt",
  "excerpt",
  "description",
  "excerpts",
  "descriptions",
  "thumbnailAlts",
  "images",
  "categories",
  "tags",
  "markets",
  "blogId",
  "authorId",
  "author",
  "searchEngines",
  "aiAssistants",
  "rememberedModal",
];

const ordered = (facts: ListFacts) => JSON.stringify(KEYS.map((key) => facts[key]));

/** Whether two pages' list facts are the same: then a publish of the one over the other changes nothing other pages show. */
export function sameListFacts(a: ListFacts, b: ListFacts): boolean {
  return ordered(a) === ordered(b);
}
