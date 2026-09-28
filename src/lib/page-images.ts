import type { PageContent } from "./page-content";
import { mapTexts } from "./page-translation";

/**
 * A page's pictures and their alt texts (D89). The site shows a picture in
 * the media library with the library's alt text wherever the page gives it
 * none of its own, in the page's language where the library has one.
 */

/** A picture's alt texts in the media library: the owner's main language's, and the others' by locale. */
export type LibraryAlt = { alt: string; translations: Record<string, string> };

/** The page's own pictures by where their alt texts are (`block.{id}.alt`, `thumbnail.alt`). */
function picturesByKey(content: PageContent): Map<string, string> {
  const pictures = new Map<string, string>();
  if (content.thumbnail) pictures.set("thumbnail.alt", content.thumbnail.url);
  for (const row of content.rows) {
    for (const column of row.columns) {
      for (const block of column.blocks) {
        if (block.type === "image" && block.image) pictures.set(`block.${block.id}.alt`, block.image.url);
      }
    }
  }
  return pictures;
}

/** The addresses of the page's pictures (its own picture first), for search engines' image sitemaps and alt lookups. */
export function pageImageUrls(content: PageContent): string[] {
  return [...new Set(picturesByKey(content).values())];
}

/**
 * The page with each picture that has no alt text of its own described by
 * the library's: its main language's on the page, the library's others in
 * the page's translations (where the page has none for it). A picture the
 * page describes itself keeps its words in every language.
 */
export function withLibraryAlts(content: PageContent, lookup: (url: string) => LibraryAlt | undefined): PageContent {
  const pictures = picturesByKey(content);
  const translations = { ...(content.translations ?? {}) };
  let changed = false;
  const filled = mapTexts(content, (key, value) => {
    const url = pictures.get(key);
    if (url === undefined || typeof value !== "string" || value.trim() !== "") return value;
    const library = lookup(url);
    if (!library?.alt) return value;
    for (const [locale, text] of Object.entries(library.translations)) {
      if (!text || translations[locale]?.[key]) continue;
      translations[locale] = { ...translations[locale], [key]: text };
    }
    changed = true;
    return library.alt;
  });
  return changed ? { ...filled, translations } : content;
}
