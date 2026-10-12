import { z } from "zod";

/**
 * How hover changes play out (D206): how long a colour, shadow or movement takes to change while the pointer comes and
 * goes, and its easing, chosen from a closed list (never owner text as CSS). The theme sets them for the whole site
 * (`ThemeSettings.hover`, as `--kz-hover-dur`/`--kz-hover-ease` by `themeCss()`), a row, column or component for itself
 * and what it holds (`PartMotion.hoverTime`, drawn by `partFx()`), and the rules in `globals.css` and `motion.css` read
 * them. Nothing moves for a visitor who prefers less motion: the change is then at once.
 */

export const HOVER_EASES = {
  ease: "Ease",
  "ease-out": "Ease out",
  "ease-in-out": "Ease in and out",
  linear: "Linear",
  smooth: "Smooth",
  snappy: "Snappy",
  springy: "Springy",
} as const;
export type HoverEase = keyof typeof HOVER_EASES;
export const HOVER_EASE_IDS = Object.keys(HOVER_EASES) as [HoverEase, ...HoverEase[]];

const EASE_CSS: Record<HoverEase, string> = {
  ease: "ease",
  "ease-out": "ease-out",
  "ease-in-out": "ease-in-out",
  linear: "linear",
  smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
  snappy: "cubic-bezier(0.22, 1, 0.36, 1)",
  springy: "cubic-bezier(0.34, 1.56, 0.64, 1)",
};

/** What a hover takes when nothing is set, in milliseconds, and the most it may take. */
export const HOVER_DURATION_DEFAULT = 200;
export const HOVER_DURATION_MAX = 2000;

export type HoverTiming = { duration?: number; ease?: HoverEase };

export const hoverTimingSchema = z
  .object({
    duration: z.number().int().min(0).max(HOVER_DURATION_MAX, `A hover takes at most ${HOVER_DURATION_MAX / 1000} seconds.`).optional(),
    ease: z.enum(HOVER_EASE_IDS).optional(),
  })
  .optional()
  .transform((timing) => (timing && (timing.duration !== undefined || timing.ease) ? timing : undefined));

/** The custom properties a timing sets, for a style or a theme's CSS; none for what is not set. */
export function hoverTimingVars(timing: HoverTiming | undefined): Record<string, string> {
  if (!timing) return {};
  return {
    ...(timing.duration !== undefined && { "--kz-hover-dur": `${timing.duration}ms` }),
    ...(timing.ease && { "--kz-hover-ease": EASE_CSS[timing.ease] }),
  };
}

/**
 * How a button answers the pointer (D206): a closed list drawn by `[data-hover]` rules in `globals.css`. `fade` is what
 * buttons always did. A button's own choice wins; else the theme's (`ThemeSettings.hover.button`, `data-button-hover` on
 * the page); else `fade`.
 */
export const BUTTON_HOVERS = {
  fade: { label: "Fade", hint: "Softens a little (as before)." },
  darken: { label: "Darken", hint: "Its colour deepens." },
  lighten: { label: "Lighten", hint: "Its colour brightens." },
  lift: { label: "Lift", hint: "Rises with a soft shadow." },
  grow: { label: "Grow", hint: "Gets a little bigger." },
  shadow: { label: "Shadow", hint: "A soft shadow appears under it." },
  sweep: { label: "Fill sweep", hint: "A tint sweeps in from the left." },
  invert: { label: "Invert", hint: "Fill and text swap: a filled button becomes an outline and back." },
  underline: { label: "Underline", hint: "A line draws itself under the words." },
  arrow: { label: "Arrow", hint: "An arrow slides in after the words." },
  shine: { label: "Shine", hint: "A glint sweeps across." },
  glow: { label: "Glow", hint: "A soft glow in its colour." },
  none: { label: "None", hint: "Stays as it is." },
} as const;
export type ButtonHover = keyof typeof BUTTON_HOVERS;
export const BUTTON_HOVER_IDS = Object.keys(BUTTON_HOVERS) as [ButtonHover, ...ButtonHover[]];

/** The theme's hover settings: the site-wide timing and the buttons' default answer. */
export type ThemeHover = HoverTiming & { button?: ButtonHover };
export const themeHoverSchema = z
  .object({
    duration: z.number().int().min(0).max(HOVER_DURATION_MAX).optional(),
    ease: z.enum(HOVER_EASE_IDS).optional(),
    button: z.enum(BUTTON_HOVER_IDS).optional(),
  })
  .optional();
