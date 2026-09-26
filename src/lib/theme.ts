import { z } from "zod";

import { fontFamily, type SiteFonts } from "./fonts";

/**
 * Store design themes (D60): every style setting of a storefront, the
 * built-in templates they start from, and the CSS that applies them. Shared
 * by the storefront, the admin's Design page and its preview.
 *
 * A theme is only settings: colours as CSS variables (a light and a dark
 * set), fonts (self-hosted, D59) and a few choices drawn by globals.css
 * through data attributes on `<html>`. Nothing in it is ever raw CSS.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** One colour set. `text` is the main text, `muted` secondary text, `accent` buttons and highlights. */
export const PALETTE_KEYS = ["background", "surface", "text", "muted", "border", "accent", "accentText"] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, string>;

export const PALETTE_LABELS: Record<PaletteKey, { name: string; hint: string }> = {
  background: { name: "Background", hint: "Behind everything." },
  surface: { name: "Surface", hint: "Panels, the footer and picture placeholders." },
  text: { name: "Text", hint: "Headings and body text." },
  muted: { name: "Secondary text", hint: "Notes, dates and prices' labels." },
  border: { name: "Lines", hint: "Borders and dividers." },
  accent: { name: "Accent", hint: "Buttons and highlights." },
  accentText: { name: "Text on accent", hint: "Text on buttons." },
};

export const COLOR_MODES = { auto: "Follow the visitor's device", light: "Always light", dark: "Always dark" } as const;
export type ColorMode = keyof typeof COLOR_MODES;

export const HEADING_WEIGHTS = { normal: 400, medium: 500, semibold: 600, bold: 700 } as const;
export type HeadingWeight = keyof typeof HEADING_WEIGHTS;
export const HEADING_CASES = { normal: "As written", upper: "Capitals, spaced" } as const;
export type HeadingCase = keyof typeof HEADING_CASES;

export const BUTTON_CORNERS = { square: "Square", rounded: "Rounded", pill: "Pill" } as const;
export type ButtonCorners = keyof typeof BUTTON_CORNERS;
export const CARD_CORNERS = { none: "None", small: "Small", medium: "Medium", large: "Large" } as const;
export type CardCorners = keyof typeof CARD_CORNERS;
export const FIELD_CORNERS = { none: "None", small: "Small", large: "Large" } as const;
export type FieldCorners = keyof typeof FIELD_CORNERS;
export const BUTTON_STYLES = { filled: "Filled", outline: "Outline" } as const;
export type ButtonStyle = keyof typeof BUTTON_STYLES;

export const CONTENT_WIDTHS = { narrow: "Narrow", normal: "Normal", wide: "Wide" } as const;
export type ContentWidth = keyof typeof CONTENT_WIDTHS;
export const HEADER_ALIGNS = { left: "Logo on the left", center: "Logo in the middle" } as const;
export type HeaderAlign = keyof typeof HEADER_ALIGNS;
export const HEADER_BACKGROUNDS = {
  page: "Like the page",
  surface: "Surface colour",
  accent: "Accent colour",
  inverse: "Inverted (text colour)",
} as const;
export type HeaderBackground = keyof typeof HEADER_BACKGROUNDS;

export const CARD_IMAGES = { square: "Square", portrait: "Portrait", landscape: "Landscape" } as const;
export type CardImage = keyof typeof CARD_IMAGES;
export const CARD_STYLES = { plain: "Plain", bordered: "Bordered", raised: "Raised" } as const;
export type CardStyle = keyof typeof CARD_STYLES;
export const CARD_ALIGNS = { left: "Left", center: "Centred" } as const;
export type CardAlign = keyof typeof CARD_ALIGNS;

export type ThemeSettings = {
  mode: ColorMode;
  light: Palette;
  dark: Palette;
  fonts: SiteFonts;
  headings: { weight: HeadingWeight; case: HeadingCase };
  buttons: { style: ButtonStyle; corners: ButtonCorners };
  corners: { cards: CardCorners; fields: FieldCorners };
  layout: { width: ContentWidth; headerAlign: HeaderAlign; headerBackground: HeaderBackground };
  productCards: { image: CardImage; style: CardStyle; align: CardAlign };
};

const keys = <T extends Record<string, unknown>>(record: T) => Object.keys(record) as [keyof T & string, ...(keyof T & string)[]];
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits, like #1f2937.").transform((v) => v.toLowerCase());
const palette = z.object(Object.fromEntries(PALETTE_KEYS.map((key) => [key, hex])) as Record<PaletteKey, typeof hex>);
const optionalFamily = z.preprocess((v) => (v === "" || v === null ? undefined : v), fontFamily.optional());

export const themeSettingsSchema = z.object({
  mode: z.enum(keys(COLOR_MODES)),
  light: palette,
  dark: palette,
  fonts: z.object({ heading: optionalFamily, body: optionalFamily }),
  headings: z.object({ weight: z.enum(keys(HEADING_WEIGHTS)), case: z.enum(keys(HEADING_CASES)) }),
  buttons: z.object({ style: z.enum(keys(BUTTON_STYLES)), corners: z.enum(keys(BUTTON_CORNERS)) }),
  corners: z.object({ cards: z.enum(keys(CARD_CORNERS)), fields: z.enum(keys(FIELD_CORNERS)) }),
  layout: z.object({
    width: z.enum(keys(CONTENT_WIDTHS)),
    headerAlign: z.enum(keys(HEADER_ALIGNS)),
    headerBackground: z.enum(keys(HEADER_BACKGROUNDS)),
  }),
  productCards: z.object({
    image: z.enum(keys(CARD_IMAGES)),
    style: z.enum(keys(CARD_STYLES)),
    align: z.enum(keys(CARD_ALIGNS)),
  }),
}) satisfies z.ZodType<ThemeSettings, unknown>;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * The built-in themes. Minimal is the demo store's own look, collected
 * from what the storefront drew before themes; Warm classic is its first
 * variation, and Bold modern its second (D60).
 */
export const THEME_TEMPLATES = {
  minimal: {
    name: "Minimal",
    description: "Quiet and neutral: system fonts, black and white, pill buttons. Follows the visitor's light or dark mode.",
    settings: {
      mode: "auto",
      light: {
        background: "#ffffff",
        surface: "#f5f5f4",
        text: "#171717",
        muted: "#525252",
        border: "#e5e5e5",
        accent: "#171717",
        accentText: "#ffffff",
      },
      dark: {
        background: "#0a0a0a",
        surface: "#1c1c1c",
        text: "#ededed",
        muted: "#a3a3a3",
        border: "#2e2e2e",
        accent: "#ededed",
        accentText: "#0a0a0a",
      },
      fonts: {},
      headings: { weight: "semibold", case: "normal" },
      buttons: { style: "filled", corners: "pill" },
      corners: { cards: "medium", fields: "small" },
      layout: { width: "normal", headerAlign: "left", headerBackground: "page" },
      productCards: { image: "square", style: "plain", align: "left" },
    },
  },
  warm: {
    name: "Warm classic",
    description: "Cream paper and terracotta, Playfair Display headings over Lora, softly rounded bordered cards and a centred logo.",
    settings: {
      mode: "light",
      light: {
        background: "#faf6ef",
        surface: "#f1e8da",
        text: "#2b2118",
        muted: "#6b5a4a",
        border: "#e2d5c1",
        accent: "#a84a26",
        accentText: "#fffaf3",
      },
      dark: {
        background: "#1c1612",
        surface: "#2a211b",
        text: "#f3eadf",
        muted: "#bfae98",
        border: "#43362c",
        accent: "#e58a5f",
        accentText: "#1c1612",
      },
      fonts: { heading: "Playfair Display", body: "Lora" },
      headings: { weight: "semibold", case: "normal" },
      buttons: { style: "filled", corners: "rounded" },
      corners: { cards: "small", fields: "small" },
      layout: { width: "normal", headerAlign: "center", headerBackground: "page" },
      productCards: { image: "portrait", style: "bordered", align: "center" },
    },
  },
  bold: {
    name: "Bold modern",
    description: "High contrast: a black header, square corners, a bright orange accent, Archivo headings in spaced capitals and edge-to-edge product pictures.",
    settings: {
      mode: "auto",
      light: {
        background: "#ffffff",
        surface: "#f0f0f0",
        text: "#0a0a0a",
        muted: "#525252",
        border: "#0a0a0a",
        accent: "#ff4f00",
        accentText: "#0a0a0a",
      },
      dark: {
        background: "#0a0a0a",
        surface: "#1a1a1a",
        text: "#f5f5f5",
        muted: "#a3a3a3",
        border: "#f5f5f5",
        accent: "#ff5c1a",
        accentText: "#0a0a0a",
      },
      fonts: { heading: "Archivo", body: "Inter" },
      headings: { weight: "bold", case: "upper" },
      buttons: { style: "filled", corners: "square" },
      corners: { cards: "none", fields: "none" },
      layout: { width: "wide", headerAlign: "left", headerBackground: "inverse" },
      productCards: { image: "portrait", style: "plain", align: "left" },
    },
  },
} as const satisfies Record<string, { name: string; description: string; settings: ThemeSettings }>;

export type ThemeTemplate = keyof typeof THEME_TEMPLATES;
export const THEME_TEMPLATE_KEYS = Object.keys(THEME_TEMPLATES) as [ThemeTemplate, ...ThemeTemplate[]];

/** A fresh copy of a template's settings, to edit. */
export const templateSettings = (template: ThemeTemplate): ThemeSettings => structuredClone(THEME_TEMPLATES[template].settings) as ThemeSettings;

// ---------------------------------------------------------------------------
// A store's theme
// ---------------------------------------------------------------------------

/**
 * What a store shows (`stores.theme`): the template it started from, the
 * saved theme it was loaded from if any (D60), and its settings.
 */
export type StoreTheme = { base: ThemeTemplate; savedId: string | null; settings: ThemeSettings };

export const storeThemeInput = z.object({
  base: z.enum(THEME_TEMPLATE_KEYS),
  savedId: z.uuid().nullable(),
  settings: themeSettingsSchema,
});

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `over` laid on `under`, object by object: what a stored theme lacks comes from its template. */
function overlay(under: unknown, over: unknown): unknown {
  if (!isPlain(under) || !isPlain(over)) return over === undefined ? under : over;
  const result: Record<string, unknown> = { ...under };
  for (const [key, value] of Object.entries(over)) result[key] = overlay(under[key], value);
  return result;
}

/**
 * The stored theme, completed from its template; a damaged value falls
 * back to the template (the store keeps working), and none is Minimal.
 */
export function parseStoreTheme(value: unknown): StoreTheme {
  const stored = isPlain(value) ? value : {};
  const base = THEME_TEMPLATE_KEYS.includes(stored.base as ThemeTemplate) ? (stored.base as ThemeTemplate) : "minimal";
  const savedId = typeof stored.savedId === "string" && z.uuid().safeParse(stored.savedId).success ? stored.savedId : null;
  const parsed = themeSettingsSchema.safeParse(overlay(templateSettings(base), stored.settings));
  return { base, savedId, settings: parsed.success ? parsed.data : templateSettings(base) };
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const BUTTON_RADIUS: Record<ButtonCorners, string> = { square: "0", rounded: "0.375rem", pill: "9999px" };
const CARD_RADIUS: Record<CardCorners, string> = { none: "0", small: "0.25rem", medium: "0.5rem", large: "1rem" };
const FIELD_RADIUS: Record<FieldCorners, string> = { none: "0", small: "0.375rem", large: "0.75rem" };
const WIDTH: Record<ContentWidth, string> = { narrow: "56rem", normal: "64rem", wide: "80rem" };
const ASPECT: Record<CardImage, string> = { square: "1 / 1", portrait: "3 / 4", landscape: "4 / 3" };

const paletteVars = (p: Palette, scheme: "light" | "dark") =>
  [
    `color-scheme: ${scheme}`,
    `--background: ${p.background}`,
    `--surface: ${p.surface}`,
    `--foreground: ${p.text}`,
    `--muted: ${p.muted}`,
    `--border: ${p.border}`,
    `--accent: ${p.accent}`,
    `--accent-foreground: ${p.accentText}`,
  ].join("; ");

/**
 * The CSS for a theme under `selector`: its colours as the variables the
 * storefront's classes read (light, dark, or each by the visitor's device),
 * and its sizes. `mode` forces one colour set, for the admin's preview.
 * Every value comes from the validated settings, never from free text.
 */
export function themeCss(settings: ThemeSettings, selector: string, mode: ColorMode = settings.mode): string {
  const sizes = [
    `--button-radius: ${BUTTON_RADIUS[settings.buttons.corners]}`,
    `--radius-lg: ${CARD_RADIUS[settings.corners.cards]}`,
    `--radius-md: ${FIELD_RADIUS[settings.corners.fields]}`,
    `--content-width: ${WIDTH[settings.layout.width]}`,
    `--card-aspect: ${ASPECT[settings.productCards.image]}`,
    `--heading-weight: ${HEADING_WEIGHTS[settings.headings.weight]}`,
  ].join("; ");
  const first = mode === "dark" ? settings.dark : settings.light;
  let css = `${selector} { ${paletteVars(first, mode === "dark" ? "dark" : "light")}; ${sizes}; }`;
  if (mode === "auto") css += `\n@media (prefers-color-scheme: dark) { ${selector} { ${paletteVars(settings.dark, "dark")}; } }`;
  return css;
}

/** The data attributes globals.css draws a theme's choices from, on `<html>` (or the preview's box). */
export function themeAttributes(settings: ThemeSettings): Record<string, string> {
  return {
    "data-store-theme": "",
    "data-button-style": settings.buttons.style,
    "data-heading-case": settings.headings.case,
    "data-card-style": settings.productCards.style,
    "data-card-align": settings.productCards.align,
  };
}

// ---------------------------------------------------------------------------
// Readability
// ---------------------------------------------------------------------------

function luminance(color: string): number {
  const channel = (i: number) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG's contrast ratio of two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Colour pairs that fall below WCAG AA for normal text (4.5:1), in the sets
 * the theme shows; the editor warns about them rather than refusing, so an
 * owner can work through a palette.
 */
export function themeWarnings(settings: ThemeSettings): string[] {
  const sets = settings.mode === "auto" ? (["light", "dark"] as const) : ([settings.mode] as const);
  const pairs: [PaletteKey, PaletteKey, string][] = [
    ["text", "background", "Text on the background"],
    ["muted", "background", "Secondary text on the background"],
    ["text", "surface", "Text on the surface colour"],
    ["accentText", "accent", "Text on the accent colour"],
  ];
  return sets.flatMap((set) =>
    pairs.flatMap(([a, b, what]) => {
      const ratio = contrastRatio(settings[set][a], settings[set][b]);
      return ratio < 4.5 ? [`${what} in the ${set} colours is hard to read (${ratio.toFixed(1)}:1; aim for 4.5:1).`] : [];
    }),
  );
}
