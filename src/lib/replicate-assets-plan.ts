import { backgroundUrls, firstFamily, walk, type PageCapture } from "./replicate-capture";

/**
 * What a captured page needs downloading (D150): its pictures in the order it shows them, its video files, and the typefaces its
 * text is set in that may need installing. Pure, so it is tested without a network; `src/server/replicate-assets.ts` fetches them.
 */

export const PICTURES_MAX = 120;
export const VIDEOS_MAX = 6;
export const FONTS_MAX = 6;

/** The pictures a page uses, in the order it shows them, from both widths; pictures made of an element are not here. */
export function pictureAddresses(captures: (PageCapture | null)[]): { urls: string[]; over: number } {
  const seen = new Set<string>();
  for (const capture of captures) {
    if (!capture) continue;
    for (const node of walk(capture.root)) {
      if (node.media?.kind === "img") seen.add(node.media.url);
      if (node.media?.kind === "video" && node.media.poster) seen.add(node.media.poster);
      for (const url of node.bg ?? []) seen.add(url);
      for (const url of backgroundUrls(node.s.backgroundImage)) if (/^https?:/i.test(url)) seen.add(url);
    }
  }
  const all = [...seen];
  return { urls: all.slice(0, PICTURES_MAX), over: Math.max(0, all.length - PICTURES_MAX) };
}

/** The video files of a page (not streams or embeds), at most `VIDEOS_MAX`. */
export function videoAddresses(captures: (PageCapture | null)[]): string[] {
  const seen = new Set<string>();
  for (const capture of captures) {
    if (!capture) continue;
    for (const node of walk(capture.root)) if (node.media?.kind === "video" && node.media.url) seen.add(node.media.url);
  }
  return [...seen].slice(0, VIDEOS_MAX);
}

/** Faces every browser has: nothing to install, and the original's own stack serves. */
const SYSTEM = new Set(
  [
    "arial",
    "helvetica",
    "helvetica neue",
    "times new roman",
    "times",
    "georgia",
    "verdana",
    "tahoma",
    "trebuchet ms",
    "courier new",
    "courier",
    "system-ui",
    "-apple-system",
    "blinkmacsystemfont",
    "segoe ui",
    "sans-serif",
    "serif",
    "monospace",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "cursive",
    "impact",
    "comic sans ms",
  ],
);

/** The families the page's text is set in, most used first, that may need installing. */
export function fontFamilies(capture: PageCapture): { wanted: string[]; system: string[] } {
  const tally = new Map<string, number>();
  for (const font of capture.fonts) {
    const family = firstFamily(font.family);
    if (family) tally.set(family, (tally.get(family) ?? 0) + font.chars);
  }
  const ordered = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([family]) => family);
  return { wanted: ordered.filter((f) => !SYSTEM.has(f.toLowerCase())).slice(0, FONTS_MAX), system: ordered.filter((f) => SYSTEM.has(f.toLowerCase())) };
}

