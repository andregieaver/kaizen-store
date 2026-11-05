/**
 * Google Fonts, self-hosted (D59): the catalogue's shape, how a family is
 * named in addresses and classes, and the fallbacks shown while it loads.
 * Shared by the site, the page builder and the server that installs fonts.
 */

import type { SiteFonts } from "./fonts-schema";

export const FONT_CATEGORIES = {
  "sans-serif": "Sans serif",
  serif: "Serif",
  display: "Display",
  handwriting: "Handwriting",
  monospace: "Monospace",
} as const;
export type FontCategory = keyof typeof FONT_CATEGORIES;

/** A family in the catalogue: its weights (100–900) upright and in italics. */
export type CatalogFont = { family: string; category: FontCategory; weights: number[]; italics: number[] };

/** `[family, category, weights, italics]`, weights as hundreds ("47" is 400 and 700): see scripts/google-fonts.mjs. */
export type CatalogRow = [string, FontCategory, string, string];

const hundreds = (digits: string) => [...digits].map((digit) => Number(digit) * 100);

export const catalogFont = ([family, category, weights, italics]: CatalogRow): CatalogFont => ({
  family,
  category,
  weights: hundreds(weights),
  italics: hundreds(italics),
});

/** A family's name as the catalogue writes it: letters, digits and spaces. */
export const FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ]{0,99}$/;

/** `Open Sans` → `open-sans`: in addresses and class names. */
export const fontSlug = (family: string) => family.trim().toLowerCase().replace(/\s+/g, "-");

/** What `fontSlug()` makes of a family's name (`FONT_FAMILY`): the addresses `/api/fonts/css/{slug}` answers. */
export const FONT_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** The class that sets a family on an element, from its stylesheet. */
export const fontClass = (family: string) => `kf-${fontSlug(family)}`;

/**
 * The version of how a family's stylesheet is written (`fontCss()`): browsers keep a stylesheet for a year without asking again,
 * so a change to what it holds raises this, which gives every stylesheet a new address.
 */
export const FONT_CSS_VERSION = 1;

/** A family's self-hosted stylesheet: its `@font-face` rules and its class. */
export const fontCssHref = (family: string) => `/api/fonts/css/${fontSlug(family)}?v=${FONT_CSS_VERSION}`;

/** What shows while a family loads, or if it cannot. */
const FALLBACKS: Record<FontCategory, string> = {
  "sans-serif": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  display: "ui-sans-serif, system-ui, sans-serif",
  handwriting: "cursive",
  monospace: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

/** `"Open Sans", ui-sans-serif, …`: a CSS font stack for a family. */
export const fontStack = (family: string, category: FontCategory) => `"${family}", ${FALLBACKS[category]}`;

/** Weights the page builder offers (`FONT_WEIGHTS`), with italics for rich text. */
const WANTED = [400, 500, 600, 700];
const WANTED_ITALICS = [400, 700];

/**
 * The styles installed for a family: the builder's weights it has (or its
 * one nearest to normal when it has none of them), and italics at 400 and
 * 700 where it has them. Browsers draw the nearest installed weight.
 */
export function installedStyles(font: CatalogFont): { weights: number[]; italics: number[] } {
  let weights = WANTED.filter((w) => font.weights.includes(w));
  if (weights.length === 0) {
    weights = [[...font.weights].sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400))[0]];
  }
  return { weights, italics: WANTED_ITALICS.filter((w) => font.italics.includes(w)) };
}

/** The lightest and heaviest of a family's installed styles: all its stylesheet asks of a variable file's weight axis (`trimRange()`). */
export function installedWeightRange(font: CatalogFont): { min: number; max: number } {
  const { weights, italics } = installedStyles(font);
  const all = [...weights, ...italics];
  return { min: Math.min(...all), max: Math.max(...all) };
}

/** Scripts kept for the EU's languages: Latin, and Greek and Cyrillic (Bulgarian). */
export const FONT_SUBSETS = ["latin", "latin-ext", "greek", "cyrillic"] as const;

/** The families a site's fonts use. */
export const siteFontFamilies = (fonts: SiteFonts) => [...new Set([fonts.heading, fonts.body].filter((f): f is string => Boolean(f)))];

/**
 * The one file a family's stylesheet (`fontCss()`) draws upright Latin text from, or null. A variable family has one such file for
 * every weight, and nearly every page needs it, so a site preloads it (`FontPreloads`) instead of finding it only after the
 * stylesheet. A family with a file per weight gives null: which weight a page draws first is not known, and a wrong guess is
 * bytes the phone fetches for nothing.
 */
export function latinUprightFile(css: string): string | null {
  const files = new Set<string>();
  for (const [, body] of css.matchAll(/\/\*\s*latin\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    if (!/font-style:\s*normal\b/.test(body)) continue;
    const file = /src:\s*url\((\/api\/fonts\/files\/[0-9a-f]{32}\.woff2)\)/.exec(body)?.[1];
    if (file) files.add(file);
  }
  return files.size === 1 ? [...files][0] : null;
}
