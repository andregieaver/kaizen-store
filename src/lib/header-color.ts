/**
 * The phone browser's own colour (`<meta name="theme-color">`) follows the header of the page shown, on Kaizena Flow's site and
 * on every store's: the status bar and the address bar look like part of the header. The colour is read from the page as drawn
 * (the theme's variables, light or dark, a row's own background, a header lying see-through over the page's first row), so it is
 * worked out in the browser (`useHeaderThemeColor`); these are its pure parts.
 */

export type Rgba = { r: number; g: number; b: number; a: number };

/** The colour of layers seen through each other, the top one first, over `base` (an opaque colour, the page's own). */
export function composite(layers: readonly Rgba[], base: Rgba): Rgba {
  let r = 0;
  let g = 0;
  let b = 0;
  // How much of what lies under the layers still shows through.
  let through = 1;
  for (const layer of [...layers, { ...base, a: 1 }]) {
    if (layer.a <= 0) continue;
    r += through * layer.a * layer.r;
    g += through * layer.a * layer.g;
    b += through * layer.a * layer.b;
    through *= 1 - layer.a;
    if (through <= 0.001) break;
  }
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: 1 };
}

/** Whether layers down to this one already hide everything under them. */
export const opaque = (layer: Rgba): boolean => layer.a >= 0.999;

/** A colour as `#rrggbb`, the form every browser takes in `theme-color`. */
export function hex({ r, g, b }: Rgba): string {
  const two = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${two(r)}${two(g)}${two(b)}`;
}

const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/i;

/**
 * The colour a background picture begins with, as written in a computed `background-image`: a gradient's first stop (`theme-color`
 * takes one colour; the header's top edge is what meets the browser's bar), or null for a picture or none.
 */
export function gradientStart(backgroundImage: string): string | null {
  if (!/gradient\(/i.test(backgroundImage)) return null;
  return COLOR.exec(backgroundImage)?.[0] ?? null;
}
