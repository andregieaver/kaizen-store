/**
 * Whether a row's or column's own background is light or dark (wave 11 unit K, D390, PSI ACC-04). A part with a background of its own
 * keeps that colour in both colour sets, while text drawn in the theme's colours (a site part's `text-muted`, a paragraph without a colour
 * of its own) follows the visitor's: dark text on a light row turned light in dark mode and could not be read (Kaizena Flow's footer
 * *Cookies* link, 1.5:1). So such a part is marked `kz-on-light` or `kz-on-dark` (`surfaceClass()`, through `rowBox()`/`columnBox()`),
 * and `themeCss()` gives what it holds the theme's colour set for that background (`surfaceCss()`), whatever the page's.
 *
 * Only a background that hides what is behind it is read: a colour at least `SURFACE_OPACITY_MIN` solid, a gradient (its colours'
 * mean luminance) or a picture or video with an overlay at least that solid; a see-through one, a picture alone or a background that
 * changes lightness at another screen size gives none (the page's colours, as before). Pure, no zod: visitors' pages read it.
 */

type SurfaceBackground =
  | { type: "color"; color: string; opacity?: number }
  | { type: "image"; overlay: { color: string; opacity: number } | null }
  | { type: "gradient"; colors: string[]; opacity?: number; overlay?: { color: string; opacity: number } | null }
  | { type: "video"; overlay: { color: string; opacity: number } | null };

export type Surface = "light" | "dark";

/** How solid a background must be before what it holds is drawn for it, in per cent. */
export const SURFACE_OPACITY_MIN = 60;

/** The luminance above which dark text reads better than light (where black and white have the same contrast). */
const LIGHT_ABOVE = Math.sqrt(1.05 * 0.05) - 0.05;

const HEX = /^#[0-9a-fA-F]{6}$/;

function luminance(colour: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(colour.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const solid = (opacity: number | undefined) => opacity === undefined || opacity >= SURFACE_OPACITY_MIN;

const ofLuminance = (value: number): Surface => (value > LIGHT_ABOVE ? "light" : "dark");

/** What a background is for the text over it: light, dark, or nothing to say. */
export function surfaceOf(background: SurfaceBackground | null | undefined): Surface | null {
  if (!background) return null;
  const overlay = "overlay" in background ? background.overlay : null;
  if (overlay && HEX.test(overlay.color) && overlay.opacity >= SURFACE_OPACITY_MIN) return ofLuminance(luminance(overlay.color));
  if (background.type === "color") return solid(background.opacity) && HEX.test(background.color) ? ofLuminance(luminance(background.color)) : null;
  if (background.type === "gradient") {
    const colours = background.colors.filter((c) => HEX.test(c));
    if (!solid(background.opacity) || colours.length === 0) return null;
    return ofLuminance(colours.reduce((sum, c) => sum + luminance(c), 0) / colours.length);
  }
  return null;
}

/**
 * A part's surface over every screen size: its own background's, unless a size's colour (`at.*.background`) is see-through or of the
 * other lightness, when none is said.
 */
export function partSurface(part: {
  background?: SurfaceBackground | null;
  at?: Partial<Record<string, { background?: { type: "color"; color: string; opacity?: number } | null } | undefined>>;
}): Surface | null {
  const own = surfaceOf(part.background);
  for (const size of Object.values(part.at ?? {})) {
    if (!size || size.background === undefined) continue;
    if (size.background === null) return null;
    if (surfaceOf(size.background) !== own) return null;
  }
  return own;
}

/** The class a part takes for its surface, or none. */
export const surfaceClass = (part: Parameters<typeof partSurface>[0]): string | undefined => {
  const surface = partSurface(part);
  return surface ? `kz-on-${surface}` : undefined;
};
