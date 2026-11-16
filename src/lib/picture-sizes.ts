import { DEFAULT_BREAKPOINTS, type Breakpoints, type Size } from "./breakpoints";

/**
 * Pictures at the visitor's device size (wave 7 unit B, D336, `docs/wave-7-storefront.md` B): every picture an owner uploads is kept
 * as two files made in the browser (D213: the picture, at most 1600 px wide, and a 480 px copy), and since bloat review step 0.33 a
 * third of 800 px for a picture wider than that, so a picture is offered as its files with `srcset` and the browser fetches the one
 * the screen needs. Nothing is resized on the server at request time (the pictures stay `unoptimized`). Pure: the components draw what
 * these return.
 */

/** The width of the library's small copy of a picture, made in the browser when it is uploaded (D213). */
export const SMALL_COPY_WIDTH = 480;
/** The widest a picture is kept at (D213); the width assumed for a picture whose own width is not known. */
export const LARGEST_PICTURE_WIDTH = 1600;
/** The width of a picture's middle copy (bloat review step 0.33): what a product tile needs on a 3x phone and a Retina laptop. */
export const MEDIUM_COPY_WIDTH = 800;

export type PictureSources = { src: string; srcSet?: string };

/**
 * Where a picture is loaded from: its files by width when it has a small copy and is wider than it (the 800 px copy between the two
 * when it has one and is wider than that), else the one file as it is. `src` is the large file, for a browser that reads no `srcset`.
 */
export function pictureSources(picture: { url: string; small?: string | null; medium?: string | null; width?: number | null }): PictureSources {
  const width = picture.width && picture.width > 0 ? Math.round(picture.width) : LARGEST_PICTURE_WIDTH;
  const small = picture.small && picture.small !== picture.url && width > SMALL_COPY_WIDTH ? picture.small : null;
  if (!small) return { src: picture.url };
  const medium = picture.medium && picture.medium !== picture.url && picture.medium !== small && width > MEDIUM_COPY_WIDTH ? picture.medium : null;
  return {
    src: picture.url,
    srcSet: medium
      ? `${small} ${SMALL_COPY_WIDTH}w, ${medium} ${MEDIUM_COPY_WIDTH}w, ${picture.url} ${width}w`
      : `${small} ${SMALL_COPY_WIDTH}w, ${picture.url} ${width}w`,
  };
}

/**
 * What a grid's tiles lose to the page's sides, in CSS pixels, both sides together (bloat review step 0.33): a row holding a grid
 * keeps 20 px a side until it is set (`ROW_PADDING`), and the smallest a theme gives a row on a phone is 16 px a side, so the
 * smaller is taken. A row given less (a full-width band) gets a claim a few pixels under its tiles; a wider gutter, a few over.
 */
export const GRID_GUTTER = 32;

type PerSize = Partial<Record<Size, number>> & { xl: number };

/** A per-size value at every size, larger to smaller: a size left out takes the one above it. */
const cascade = (values: PerSize): Record<Size, number> => {
  const lg = values.lg ?? values.xl;
  const md = values.md ?? lg;
  return { xl: values.xl, lg, md, sm: values.sm ?? md };
};

/**
 * The `sizes` of a picture that fills one column of a grid, from the grid's columns at each screen size (larger to smaller, a size
 * left out takes the one above it): `(min-width: 1280px) calc((100vw - 104px) / 4), …, calc((100vw - 56px) / 2)`. Each tile is
 * the screen less the page's sides (`GRID_GUTTER`) and the gaps between its columns (`gaps`, in pixels, by size as the columns;
 * none when left out), shared by the columns (bloat review step 0.33: a plain `50vw` claimed 180 px for a 148 px tile at 360 px,
 * so a 3x phone fetched a file almost twice as wide as it needed). A hint for the browser, so the store's default screen sizes are
 * used whatever its own; a grid in a narrower column than the row's is claimed wider than it is, which costs bytes, never sharpness.
 */
export function gridSizes(columns: PerSize, options: { gaps?: PerSize; breakpoints?: Breakpoints } = {}): string {
  const breakpoints = options.breakpoints ?? DEFAULT_BREAKPOINTS;
  const cols = cascade(columns);
  const gaps = cascade(options.gaps ?? { xl: 0 });
  const at = (size: Size) => {
    const n = Math.max(1, Math.round(cols[size]));
    const lost = GRID_GUTTER + (n - 1) * Math.max(0, gaps[size]);
    return n === 1 ? `calc(100vw - ${lost}px)` : `calc((100vw - ${lost}px) / ${n})`;
  };
  const parts: [string, string][] = [
    [`(min-width: ${breakpoints.xl}px) `, at("xl")],
    [`(min-width: ${breakpoints.lg}px) `, at("lg")],
    [`(min-width: ${breakpoints.md}px) `, at("md")],
    ["", at("sm")],
  ];
  // A size that says what the one after it says adds nothing.
  return parts
    .filter(([, value], i) => i === parts.length - 1 || value !== parts[i + 1][1])
    .map(([query, value]) => `${query}${value}`)
    .join(", ");
}

/**
 * The `sizes` of a picture drawn at most `width` CSS pixels wide (its own size, D151), and never wider than the screen. In a column
 * that keeps its `share` (0 to 1, exclusive) of the screen on a phone (`phoneShare()` in `column-share.ts`), the picture is its own
 * width once the column is that wide, and the column's share of the screen below that; any other share is the whole screen.
 */
export function fixedSizes(width: number, share = 1): string {
  const w = Math.max(1, Math.round(width));
  if (!(share > 0 && share < 1)) return `(min-width: ${w}px) ${w}px, 100vw`;
  return `(min-width: ${Math.ceil(w / share)}px) ${w}px, ${Math.round(share * 100)}vw`;
}
