import { DEFAULT_BREAKPOINTS, type Breakpoints } from "@/lib/breakpoints";
import type { PageBlock, PageRow } from "@/lib/page-content";
import { breakpointClassCss, partCss } from "@/lib/part-css";
import { breakpointsFor } from "@/server/breakpoints";

/** A short name for a stylesheet's text, so the same rules are one stylesheet to React wherever they are drawn. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}${text.length.toString(36)}`;
}

type Drawn = { rows?: PageRow[]; blocks?: PageBlock[] };

/** The rules as a stylesheet in the head, with the page's other styles (each set once, however often it is drawn). */
function Sheet({ rows = [], blocks = [], breakpoints }: Drawn & { breakpoints: Breakpoints }) {
  const css = partCss(rows, "site", breakpoints, "media", blocks);
  if (!css) return null;
  return (
    <style href={`kz-parts-${hash(css)}`} precedence="parts">
      {css}
    </style>
  );
}

/**
 * The breakpoint classes (D179 phase 3, `BREAKPOINT_CLASSES`) at these screen sizes: components' own layout (field loops,
 * custom fields, plans, tabs, testimonials, the listing, the gallery, the standard header) from a size up. One sheet per
 * set of sizes, however often it is drawn.
 */
export function BreakpointSheet({ breakpoints }: { breakpoints: Breakpoints }) {
  const css = breakpointClassCss(breakpoints, "media");
  return (
    <style href={`kz-bp-${hash(css)}`} precedence="parts">
      {css}
    </style>
  );
}

/** A store's: its theme's screen sizes, read from the cached store. */
async function StoreSheet({ owner, ...drawn }: Drawn & { owner: string }) {
  const breakpoints = await breakpointsFor(owner);
  return (
    <>
      <BreakpointSheet breakpoints={breakpoints} />
      <Sheet {...drawn} breakpoints={breakpoints} />
    </>
  );
}


/**
 * The part stylesheet of rows on the site (D179, `src/lib/part-css.ts`): what their settings say at each of the screen
 * sizes, a store's own (its theme) or Kaizen's (the defaults). Every place that draws rows draws this beside them
 * (`PageRowView`), and a listing its grid's (`blocks`).
 */
export function PartStyles({ owner, ...drawn }: Drawn & { owner: string | null }) {
  return owner ? (
    <StoreSheet owner={owner} {...drawn} />
  ) : (
    <>
      <BreakpointSheet breakpoints={DEFAULT_BREAKPOINTS} />
      <Sheet {...drawn} breakpoints={DEFAULT_BREAKPOINTS} />
    </>
  );
}
