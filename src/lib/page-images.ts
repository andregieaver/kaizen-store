import { withChildren, type Background, type PageContent, type RowBackground } from "./page-content";
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
      for (const block of withChildren(column.blocks)) {
        if (block.type === "image" && block.image) pictures.set(`block.${block.id}.alt`, block.image.url);
        // A gallery's pictures (D209), each described by its own alt text, or the library's.
        if (block.type === "gallery") for (const item of block.items) if (item.kind === "image" && item.picture) pictures.set(`block.${block.id}.${item.id}.alt`, item.picture.url);
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

/** The pictures behind the page's rows and columns (D48), whose small copies a phone can be given. */
export function backgroundImageUrls(content: PageContent): string[] {
  const urls = new Set<string>();
  for (const row of content.rows) {
    if (row.background?.type === "image") urls.add(row.background.image.url);
    for (const column of row.columns) if (column.background?.type === "image") urls.add(column.background.image.url);
  }
  return [...urls];
}

/**
 * The page with each background picture's small copy (`image.small`, the library's 480 px one) where the library has one, so a phone
 * is not sent the large file and a blurred picture loads the small one only. Set when the page is read, never saved (the page's
 * schema drops it).
 */
export function withSmallCopies(content: PageContent, lookup: (url: string) => string | undefined): PageContent {
  let changed = false;
  const fill = <B extends Background | RowBackground | undefined>(background: B): B => {
    if (background?.type !== "image") return background;
    const small = lookup(background.image.url);
    if (!small || small === background.image.url || background.image.small === small) return background;
    changed = true;
    return { ...background, image: { ...background.image, small } };
  };
  const rows = content.rows.map((row) => ({
    ...row,
    background: fill(row.background),
    columns: row.columns.map((column) => ({ ...column, background: fill(column.background) })),
  }));
  return changed ? { ...content, rows } : content;
}

/** Blurred this much or more, a background picture's small copy looks the same as the large one, so only the small one is sent. */
export const SMALL_ENOUGH_BLUR = 4;

/**
 * Where a background picture is loaded from: the small copy alone when it is blurred (`SMALL_ENOUGH_BLUR`), else the large one
 * with the small one offered beside it (`srcSet`, by width) for a narrow screen. Without a small copy, the picture as it is.
 */
export function backgroundSources(image: { url: string; width: number; small?: string }, blur: number): { src: string; srcSet?: string } {
  const small = image.small && image.width > SMALL_COPY_WIDTH ? image.small : undefined;
  if (!small) return { src: image.url };
  if (blur >= SMALL_ENOUGH_BLUR) return { src: small };
  return { src: image.url, srcSet: `${small} ${SMALL_COPY_WIDTH}w, ${image.url} ${image.width}w` };
}
/** The width of the library's small copy of a picture, made in the browser when it is uploaded. */
export const SMALL_COPY_WIDTH = 480;
