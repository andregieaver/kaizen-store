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

// ---------------------------------------------------------------------------
// The builder's canvas at a size (D179 phase 2)
// ---------------------------------------------------------------------------

/** The narrowest canvas the builder offers, and the widest. */
export const CANVAS_MIN = 320;
export const CANVAS_MAX = 3840;

/** A screen typical of each size: a computer, a small laptop, a tablet held upright, a phone. */
export const TYPICAL_SCREENS: Record<Size, { width: number; height: number }> = {
  xl: { width: 1440, height: 900 },
  lg: { width: 1100, height: 800 },
  md: { width: 820, height: 1180 },
  sm: { width: 390, height: 844 },
};

/** The widths that are a size with these breakpoints, in whole pixels. */
export function sizeRange(breakpoints: Breakpoints, size: Size): { min: number; max: number } {
  const b = breakpointsOf({ breakpoints });
  if (size === "sm") return { min: CANVAS_MIN, max: b.md - 1 };
  if (size === "md") return { min: b.md, max: b.lg - 1 };
  if (size === "lg") return { min: b.lg, max: b.xl - 1 };
  return { min: b.xl, max: Math.max(b.xl, CANVAS_MAX) };
}

/** A width kept within a size's range. */
export function clampWidth(breakpoints: Breakpoints, size: Size, width: number): number {
  const { min, max } = sizeRange(breakpoints, size);
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(width) ? width : min)));
}

/** The canvas's width when a size is chosen: the typical screen's, or the middle of the size where the store's widths leave it out. */
export function typicalWidth(breakpoints: Breakpoints, size: Size): number {
  const { min, max } = sizeRange(breakpoints, size);
  const typical = TYPICAL_SCREENS[size].width;
  if (typical >= min && typical <= max) return typical;
  return size === "xl" ? min + 160 : Math.round((min + max) / 2);
}

/** The size a width is, with these breakpoints. */
export function sizeOfWidth(breakpoints: Breakpoints, width: number): Size {
  const b = breakpointsOf({ breakpoints });
  return width >= b.xl ? "xl" : width >= b.lg ? "lg" : width >= b.md ? "md" : "sm";
}

/** The zooms the canvas offers, in per cent. */
export const ZOOMS = [100, 90, 75, 67, 50] as const;

/** The largest zoom at which a canvas this wide fits the room there is (at least 50 %). */
export function fitZoom(room: number, width: number): number {
  if (!(room > 0) || !(width > 0)) return 100;
  return ZOOMS.find((zoom) => (width * zoom) / 100 <= room) ?? ZOOMS[ZOOMS.length - 1];
}
