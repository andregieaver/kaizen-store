import { DEFAULT_BREAKPOINTS, type Breakpoints, type Size } from "./breakpoints";

/**
 * Pictures at the visitor's device size (wave 7 unit B, D336, `docs/wave-7-storefront.md` B): every picture an owner uploads is kept
 * as two files made in the browser (D213: the picture, at most 1600 px wide, and a 480 px copy), so a picture is offered as both with
 * `srcset` and the browser fetches the one the screen needs. Nothing is resized on the server (the pictures stay `unoptimized`). Pure:
 * the components draw what these return.
 */

/** The width of the library's small copy of a picture, made in the browser when it is uploaded (D213). */
export const SMALL_COPY_WIDTH = 480;
/** The widest a picture is kept at (D213); the width assumed for a picture whose own width is not known. */
export const LARGEST_PICTURE_WIDTH = 1600;

export type PictureSources = { src: string; srcSet?: string };

/**
 * Where a picture is loaded from: both files by width when it has a small copy and is wider than it, else the one file as it is.
 * `src` is the large file, for a browser that reads no `srcset`.
 */
export function pictureSources(picture: { url: string; small?: string | null; width?: number | null }): PictureSources {
  const width = picture.width && picture.width > 0 ? Math.round(picture.width) : LARGEST_PICTURE_WIDTH;
  const small = picture.small && picture.small !== picture.url && width > SMALL_COPY_WIDTH ? picture.small : null;
  if (!small) return { src: picture.url };
  return { src: picture.url, srcSet: `${small} ${SMALL_COPY_WIDTH}w, ${picture.url} ${width}w` };
}

/**
 * The `sizes` of a picture that fills one column of a grid, from the grid's columns at each screen size (larger to smaller, a size
 * left out takes the one above it): `(min-width: 1280px) 25vw, …, 50vw`. A hint for the browser, so the store's default screen sizes
 * are used whatever its own (a few pixels either way only move which of the two files is fetched).
 */
export function gridSizes(columns: Partial<Record<Size, number>> & { xl: number }, breakpoints: Breakpoints = DEFAULT_BREAKPOINTS): string {
  const at = (n: number) => `${Math.round(100 / Math.max(1, n))}vw`;
  const lg = columns.lg ?? columns.xl;
  const md = columns.md ?? lg;
  const sm = columns.sm ?? md;
  const parts = [`(min-width: ${breakpoints.xl}px) ${at(columns.xl)}`, `(min-width: ${breakpoints.lg}px) ${at(lg)}`, `(min-width: ${breakpoints.md}px) ${at(md)}`, at(sm)];
  // A size that says what the one after it says adds nothing.
  return parts.filter((part, i) => i === parts.length - 1 || part.split(" ").pop() !== parts[i + 1].split(" ").pop()).join(", ");
}

/** The `sizes` of a picture drawn at most `width` CSS pixels wide (its own size, D151), and never wider than the screen. */
export function fixedSizes(width: number): string {
  const w = Math.max(1, Math.round(width));
  return `(min-width: ${w}px) ${w}px, 100vw`;
}
