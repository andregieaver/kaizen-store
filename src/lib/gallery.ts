import type { Size } from "./breakpoints";
import { GALLERY_DEFAULTS, galleryItemShows, type GalleryBlock, type GalleryItem, type GalleryRatio } from "./page-content";
import { valueAt } from "./responsive";
import { embedUrl, type EmbedSource } from "./video-embed";

/**
 * How many tiles are in a row at a screen size (D209): the owner's value for the size (`at.*.columns`, else the block's own for
 * Extra large), and with none set for the size or a larger one the block's columns on computers, at most three on Medium and two
 * on Small. In a carousel they are the tiles seen at once.
 */
export function galleryColumns(block: Pick<GalleryBlock, "columns" | "at">, size: Size): number {
  const base = block.columns ?? GALLERY_DEFAULTS.columns;
  const chain: Record<Size, readonly ("lg" | "md" | "sm")[]> = { xl: [], lg: ["lg"], md: ["md", "lg"], sm: ["sm", "md", "lg"] };
  if (chain[size].some((s) => block.at?.[s]?.columns !== undefined)) return valueAt(block, "columns", size) ?? base;
  if (size === "md") return Math.min(3, base);
  if (size === "sm") return Math.min(2, base);
  return base;
}

/** A tile's shape as CSS, or none for a tile in its picture's own shape. */
export function galleryAspect(ratio: GalleryRatio | undefined): string | undefined {
  const value = ratio ?? GALLERY_DEFAULTS.ratio;
  return value === "auto" ? undefined : value.replace(":", " / ");
}

/** What the lightbox shows of one piece: a picture, an uploaded video, or a YouTube or Vimeo player's address. */
export type GallerySlide =
  | { kind: "image"; key: string; src: string; width: number; height: number; alt: string; caption: string }
  | { kind: "upload"; key: string; src: string; poster: string | undefined; title: string; caption: string }
  | { kind: "embed"; key: string; source: EmbedSource; player: string; poster: string | undefined; title: string; caption: string };

/** The pieces that show, as the lightbox draws them, in the gallery's order. */
export function gallerySlides(items: readonly GalleryItem[]): GallerySlide[] {
  return items.filter(galleryItemShows).map((item): GallerySlide => {
    if (item.kind === "image") {
      const picture = item.picture!;
      return { kind: "image", key: item.id, src: picture.url, width: picture.width, height: picture.height, alt: item.alt, caption: item.caption };
    }
    const source = item.source ?? "upload";
    if (source === "upload") return { kind: "upload", key: item.id, src: item.video!.url, poster: item.picture?.url, title: item.alt, caption: item.caption };
    return { kind: "embed", key: item.id, source, player: embedUrl(source, item.link ?? "")!, poster: item.picture?.url, title: item.alt, caption: item.caption };
  });
}

/** The slide after or before `index`, going round. */
export const stepSlide = (index: number, by: 1 | -1, count: number): number => (count === 0 ? 0 : (index + by + count) % count);
