/**
 * What the media library's Compress (D213) does with a file, decided in one place for the library and the server: whether it
 * is offered at all, whether the result may be AVIF, and whether the original stays in Storage after its uses moved to the
 * smaller one. Pure.
 *
 * AVIF is for pages only: product pictures, share pictures, the chat agent's picture and the logo are also read by emails,
 * feeds, social networks and AI models, not all of which read AVIF. A file in such a place also keeps its original in
 * Storage, as an email already sent or a preview a network already took still points at it.
 */

/** Places a file's use is drawn only on the site's own pages (`MediaUse.source`). */
export const PAGE_SOURCES = ["page", "menu", "saved", "theme"] as const;

/** Places whose pictures leave the site: emails, feeds, social previews (a theme's share image among them), models. */
export const SENT_SOURCES = ["product", "seo", "chat", "navigation", "theme_listing"] as const;

export type CompressCandidate = {
  kind: "image" | "video";
  contentType: string;
  compressedAt: string | null;
  uses: { source?: string }[];
};

export type CompressPlan = { offered: true; avif: boolean } | { offered: false; why: string };

export function compressPlan(item: CompressCandidate): CompressPlan {
  if (item.compressedAt) return { offered: false, why: "Already as small as it can be while it looks the same." };
  if (item.contentType === "image/gif") return { offered: false, why: "A GIF may move, so it is kept as it is." };
  if (item.contentType === "image/svg+xml") return { offered: false, why: "A drawing (SVG) is already as small as it gets." };
  if (item.uses.some((use) => use.source === "navigation")) {
    return { offered: false, why: "It is the logo or the site's icon, which browsers and emails read as it is." };
  }
  if (item.kind === "video") return { offered: true, avif: false };
  const pagesOnly = item.uses.length > 0 && item.uses.every((use) => (PAGE_SOURCES as readonly string[]).includes(use.source ?? ""));
  return { offered: true, avif: pagesOnly };
}

/** Whether the original stays in Storage after Compress: a file used where it leaves the site. */
export const keepsOriginal = (uses: { source?: string }[]): boolean =>
  uses.some((use) => (SENT_SOURCES as readonly string[]).includes(use.source ?? ""));

/** A result smaller than this share of the original is worth keeping; anything closer is left as it was. */
export const COMPRESS_WORTH = 0.9;
