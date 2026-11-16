import { layerPictureUrls, withLayerSmallCopies, type BackgroundLayer } from "./background-layers";
import { innerColumns, mapChildBlocks, mapInnerColumns, withChildren, type Background, type PageBlock, type PageContent, type RowBackground } from "./page-content";
import { mapTexts } from "./page-translation";
import { MEDIUM_COPY_WIDTH, SMALL_COPY_WIDTH } from "./picture-sizes";

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
        // A Before and after's two pictures, each described by its own alt text (`mapBlockTexts()`'s keys), or the library's.
        if (block.type === "beforeAfter") {
          if (block.before) pictures.set(`block.${block.id}.beforeAlt`, block.before.url);
          if (block.after) pictures.set(`block.${block.id}.afterAlt`, block.after.url);
        }
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

/** The pictures behind the page's rows and columns (D48), and those that are layers over their backgrounds (D537), whose small copies a phone can be given. */
export function backgroundImageUrls(content: PageContent): string[] {
  const urls = new Set<string>();
  for (const row of content.rows) {
    if (row.background?.type === "image") urls.add(row.background.image.url);
    for (const url of layerPictureUrls(row.backgroundLayers)) urls.add(url);
    for (const column of [...row.columns, ...row.columns.flatMap((c) => c.blocks.flatMap(innerColumns))]) {
      if (column.background?.type === "image") urls.add(column.background.image.url);
      for (const url of layerPictureUrls(column.backgroundLayers)) urls.add(url);
    }
  }
  return [...urls];
}

/**
 * The page with each background picture's, picture layer's (D537) and picture component's small copy (`image.small`, the library's
 * 480 px one) where the library has one, so a phone is not sent the large file (D211, D336) and a blurred picture loads the small one
 * only. Picture components, Before and afters and row and column backgrounds are also given the 800 px copy (`image.medium`, from
 * `mediumLookup`); layers keep two files. Set when the page is read, never saved (the page's schema drops both).
 */
export function withSmallCopies(
  content: PageContent,
  lookup: (url: string) => string | undefined,
  mediumLookup: (url: string) => string | undefined = () => undefined,
): PageContent {
  let changed = false;
  /** The picture with its small and 800 px copies filled where the library has them; the same object when nothing is new. */
  const copies = <P extends { url: string; small?: string; medium?: string }>(picture: P): P => {
    const small = lookup(picture.url);
    const medium = mediumLookup(picture.url);
    const newSmall = small && small !== picture.url && picture.small !== small ? small : undefined;
    const newMedium = medium && medium !== picture.url && picture.medium !== medium ? medium : undefined;
    if (!newSmall && !newMedium) return picture;
    changed = true;
    return { ...picture, ...(newSmall ? { small: newSmall } : {}), ...(newMedium ? { medium: newMedium } : {}) };
  };
  const fill = <B extends Background | RowBackground | undefined>(background: B): B => {
    if (background?.type !== "image") return background;
    const image = copies(background.image);
    return image === background.image ? background : { ...background, image };
  };
  // The layers' pictures (D537): the key is written only where a part has layers, so a part without them stays as it was.
  const layered = (layers: BackgroundLayer[] | undefined): { backgroundLayers?: BackgroundLayer[] } => {
    if (!layers) return {};
    const filled = withLayerSmallCopies(layers, lookup);
    if (filled !== layers) changed = true;
    return { backgroundLayers: filled };
  };
  // A picture component's (D336), and a Columns component's columns' backgrounds (D294), at every depth.
  const fillBlock = (block: PageBlock): PageBlock => {
    let out = block;
    if (out.type === "image" && out.image) {
      const image = copies(out.image);
      if (image !== out.image) out = { ...out, image };
    }
    if (out.type === "beforeAfter") {
      const withCopies = <P extends { url: string; small?: string; medium?: string } | null>(picture: P): P => (picture ? copies(picture) : picture);
      out = { ...out, before: withCopies(out.before), after: withCopies(out.after) };
    }
    if (out.type === "columns") out = mapInnerColumns(out, (inner) => ({ ...inner, background: fill(inner.background), ...layered(inner.backgroundLayers) }));
    return out.type === "columns" || out.type === "faq" ? mapChildBlocks(out, fillBlock) : out;
  };
  const rows = content.rows.map((row) => ({
    ...row,
    background: fill(row.background),
    ...layered(row.backgroundLayers),
    columns: row.columns.map((column) => ({ ...column, background: fill(column.background), ...layered(column.backgroundLayers), blocks: column.blocks.map(fillBlock) })),
  }));
  return changed ? { ...content, rows } : content;
}

/** Blurred this much or more, a background picture's small copy looks the same as the large one, so only the small one is sent. */
export const SMALL_ENOUGH_BLUR = 4;

/**
 * Where a background picture is loaded from: the small copy alone when it is blurred (`SMALL_ENOUGH_BLUR`), else the large one
 * with the small one offered beside it (`srcSet`, by width) for a narrow screen, and the 800 px copy between them where there is
 * one and the picture is wider than it. Without a small copy, the picture as it is.
 */
export function backgroundSources(image: { url: string; width: number; small?: string; medium?: string }, blur: number): { src: string; srcSet?: string } {
  const small = image.small && image.width > SMALL_COPY_WIDTH ? image.small : undefined;
  if (!small) return { src: image.url };
  if (blur >= SMALL_ENOUGH_BLUR) return { src: small };
  if (image.medium && image.width > MEDIUM_COPY_WIDTH) {
    return { src: image.url, srcSet: `${small} ${SMALL_COPY_WIDTH}w, ${image.medium} ${MEDIUM_COPY_WIDTH}w, ${image.url} ${image.width}w` };
  }
  return { src: image.url, srcSet: `${small} ${SMALL_COPY_WIDTH}w, ${image.url} ${image.width}w` };
}
export { SMALL_COPY_WIDTH };
