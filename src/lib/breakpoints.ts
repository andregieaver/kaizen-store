import { z } from "zod";

/**
 * Screen sizes (D179, `docs/responsive-editing.md` 2): four, as Beaver Builder has them, each from a width up to the next.
 * A part's settings as saved are its Extra large values; the smaller sizes hold only what differs (`PartBase.at`,
 * `src/lib/responsive.ts`), passed from larger to smaller. The widths are the store's own (`ThemeSettings.breakpoints`),
 * and the defaults keep every page saved before as it was: Kaizen's phone below 768 px, tablet from 768 and computer
 * from 1024, which Large and Extra large now split at 1280.
 */

export const SIZES = ["xl", "lg", "md", "sm"] as const;
export type Size = (typeof SIZES)[number];
/** The sizes below Extra large, which hold overrides, from larger to smaller. */
export const SMALLER_SIZES = ["lg", "md", "sm"] as const;
export type SmallerSize = (typeof SMALLER_SIZES)[number];

export const SIZE_LABELS: Record<Size, string> = { xl: "Extra large", lg: "Large", md: "Medium", sm: "Small" };

/** Where each size above Small starts, in CSS pixels: Medium from `md`, Large from `lg`, Extra large from `xl`. */
export type Breakpoints = { md: number; lg: number; xl: number };

export const DEFAULT_BREAKPOINTS: Breakpoints = { md: 768, lg: 1024, xl: 1280 };
export const BREAKPOINT_MIN = 480;
export const BREAKPOINT_MAX = 2560;
/**
 * The least room between two sizes' starts, so each is a real range. (The plan said 320 px, which the defaults that keep
 * saved pages as they were, 256 px apart, could not meet; Beaver Builder's own are 208–224 px apart.)
 */
export const BREAKPOINT_GAP = 160;

/** Why a set of widths cannot be used, or null: each within 480–2560, rising, at least `BREAKPOINT_GAP` apart. */
export function breakpointsProblem(value: Breakpoints): string | null {
  const widths = [value.md, value.lg, value.xl];
  if (widths.some((w) => !Number.isInteger(w) || w < BREAKPOINT_MIN || w > BREAKPOINT_MAX)) {
    return `Screen sizes start between ${BREAKPOINT_MIN} and ${BREAKPOINT_MAX} pixels, in whole pixels.`;
  }
  if (value.lg - value.md < BREAKPOINT_GAP || value.xl - value.lg < BREAKPOINT_GAP) {
    return `Each screen size starts at least ${BREAKPOINT_GAP} pixels after the one before it: Medium, then Large, then Extra large.`;
  }
  return null;
}

const width = z.number().int().min(BREAKPOINT_MIN).max(BREAKPOINT_MAX);
export const breakpointsSchema = z
  .object({ md: width, lg: width, xl: width })
  .superRefine((value, ctx) => {
    const problem = breakpointsProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

/** The widths a theme gives, or the defaults where it gives none or ones that cannot be used. */
export function breakpointsOf(theme: { breakpoints?: Breakpoints } | null | undefined): Breakpoints {
  const parsed = breakpointsSchema.safeParse(theme?.breakpoints);
  return parsed.success ? parsed.data : DEFAULT_BREAKPOINTS;
}

/** Where the part rules are measured: the window on the site, the canvas (`kz-page`) in the builder. */
export type QueryMode = "media" | "container";

/** The container the builder's canvas is (D179 5): its width is the size being edited. */
export const PAGE_CONTAINER = "kz-page";

/**
 * The conditions of each size. `upTo` holds from the size's top down (a smaller size's overrides follow a larger's,
 * so they cascade as `valueAt()` walks); `only` is the size alone, for what is hidden at a size.
 */
export type BreakpointQueries = { upTo: Record<SmallerSize, string>; only: Record<Size, string> };

export function breakpointQueries(theme: { breakpoints?: Breakpoints } | Breakpoints | null | undefined, mode: QueryMode = "media"): BreakpointQueries {
  const b = theme && "md" in theme ? breakpointsOf({ breakpoints: theme }) : breakpointsOf(theme as { breakpoints?: Breakpoints } | null | undefined);
  const at = (condition: string) => (mode === "media" ? `@media ${condition}` : `@container ${PAGE_CONTAINER} ${condition}`);
  return {
    upTo: { lg: at(`(width < ${b.xl}px)`), md: at(`(width < ${b.lg}px)`), sm: at(`(width < ${b.md}px)`) },
    only: {
      xl: at(`(width >= ${b.xl}px)`),
      lg: at(`(${b.lg}px <= width < ${b.xl}px)`),
      md: at(`(${b.md}px <= width < ${b.lg}px)`),
      sm: at(`(width < ${b.md}px)`),
    },
  };
}

/** The condition for a run of sizes next to each other (larger to smaller), or null for none; all four is "always". */
export function sizesQuery(theme: Breakpoints, sizes: readonly Size[], mode: QueryMode = "media"): string | null | "always" {
  const set = new Set(sizes);
  if (set.size === 0) return null;
  if (set.size === SIZES.length) return "always";
  const b = breakpointsOf({ breakpoints: theme });
  const from: Record<Size, number> = { xl: b.xl, lg: b.lg, md: b.md, sm: 0 };
  const to: Record<Size, number | null> = { xl: null, lg: b.xl, md: b.lg, sm: b.md };
  const ordered = SIZES.filter((s) => set.has(s));
  // Only runs of neighbours make one condition; the callers split others.
  const top = ordered[0];
  const bottom = ordered[ordered.length - 1];
  const low = from[bottom];
  const high = to[top];
  const condition = low === 0 ? `(width < ${high}px)` : high === null ? `(width >= ${low}px)` : `(${low}px <= width < ${high}px)`;
  return mode === "media" ? `@media ${condition}` : `@container ${PAGE_CONTAINER} ${condition}`;
}

/** Runs of neighbouring sizes in `sizes`, larger to smaller: [xl, md, sm] is [[xl], [md, sm]]. */
export function sizeRuns(sizes: readonly Size[]): Size[][] {
  const runs: Size[][] = [];
  let run: Size[] = [];
  for (const size of SIZES) {
    if (sizes.includes(size)) run.push(size);
    else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}
