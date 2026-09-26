import { z } from "zod";

/**
 * Google Fonts, self-hosted (D59): the catalogue's shape, how a family is
 * named in addresses and classes, and the fallbacks shown while it loads.
 * Shared by the site, the page builder and the server that installs fonts.
 */

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
export const fontFamily = z.string().trim().regex(FONT_FAMILY, "Choose a font from the list.");

/** `Open Sans` → `open-sans`: in addresses and class names. */
export const fontSlug = (family: string) => family.trim().toLowerCase().replace(/\s+/g, "-");

/** The class that sets a family on an element, from its stylesheet. */
export const fontClass = (family: string) => `kf-${fontSlug(family)}`;

/** A family's self-hosted stylesheet: its `@font-face` rules and its class. */
export const fontCssHref = (family: string) => `/api/fonts/css/${fontSlug(family)}`;

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

/** Scripts kept for the EU's languages: Latin, and Greek and Cyrillic (Bulgarian). */
export const FONT_SUBSETS = ["latin", "latin-ext", "greek", "cyrillic"] as const;

/** A site's own fonts (D59): headings and the rest; unset keeps the system's. */
export const siteFontsSchema = z.object({
  heading: fontFamily.optional(),
  body: fontFamily.optional(),
});
export type SiteFonts = z.infer<typeof siteFontsSchema>;

/** The stored value, or no fonts if it is missing or damaged. */
export function parseSiteFonts(value: unknown): SiteFonts {
  const parsed = siteFontsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

/** The families a site's fonts use. */
export const siteFontFamilies = (fonts: SiteFonts) => [...new Set([fonts.heading, fonts.body].filter((f): f is string => Boolean(f)))];
