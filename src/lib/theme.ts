import { z } from "zod";

import { DEFAULT_BREAKPOINTS, breakpointsSchema, type Breakpoints } from "./breakpoints";
import { fontFamily, type SiteFonts } from "./fonts";
import { CONTENT_MAX_MAX, CONTENT_MAX_MIN } from "./page-content";
import { colourLibrarySchema, type ColourLibrary } from "./colour-library";
import { themeElementsSchema, type ThemeElements } from "./theme-elements";

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
  /** Visitors may choose light or dark for themselves (D99), over the store's mode; the header shows a switch. */
  visitorSwitch: boolean;
  light: Palette;
  dark: Palette;
  fonts: SiteFonts;
  headings: { weight: HeadingWeight; case: HeadingCase };
  buttons: { style: ButtonStyle; corners: ButtonCorners };
  corners: { cards: CardCorners; fields: FieldCorners };
  /** `maxWidth`: the content's width in pixels, over the choice `width` (the page builder's Theme tab). */
  layout: { width: ContentWidth; maxWidth?: number; headerAlign: HeaderAlign; headerBackground: HeaderBackground };
  productCards: { image: CardImage; style: CardStyle; align: CardAlign };
  /**
   * Where the screen sizes start (D179, `src/lib/breakpoints.ts`): the part rules of every page, header, footer and
   * layout are written for them. The defaults keep pages saved before as they were.
   */
  breakpoints?: Breakpoints;
  /**
   * What the page builder's Theme tab says for every row, heading, paragraph, list and button of the store's pages
   * (D182, `src/lib/theme-elements.ts`): typography, spacing, frame and, for rows, colour and content width.
   */
  elements?: ThemeElements;
  /** The store's saved colours and gradients (D183), offered in the page builder's colour fields and gradient editors; copied into a part when used. */
  library?: ColourLibrary;
};

const keys = <T extends Record<string, unknown>>(record: T) => Object.keys(record) as [keyof T & string, ...(keyof T & string)[]];
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits, like #1f2937.").transform((v) => v.toLowerCase());
const palette = z.object(Object.fromEntries(PALETTE_KEYS.map((key) => [key, hex])) as Record<PaletteKey, typeof hex>);
const optionalFamily = z.preprocess((v) => (v === "" || v === null ? undefined : v), fontFamily.optional());

export const themeSettingsSchema = z.object({
  mode: z.enum(keys(COLOR_MODES)),
  visitorSwitch: z.boolean().default(false),
  light: palette,
  dark: palette,
  fonts: z.object({ heading: optionalFamily, body: optionalFamily }),
  headings: z.object({ weight: z.enum(keys(HEADING_WEIGHTS)), case: z.enum(keys(HEADING_CASES)) }),
  buttons: z.object({ style: z.enum(keys(BUTTON_STYLES)), corners: z.enum(keys(BUTTON_CORNERS)) }),
  corners: z.object({ cards: z.enum(keys(CARD_CORNERS)), fields: z.enum(keys(FIELD_CORNERS)) }),
  layout: z.object({
    width: z.enum(keys(CONTENT_WIDTHS)),
    maxWidth: z.number().int().min(CONTENT_MAX_MIN).max(CONTENT_MAX_MAX).optional(),
    headerAlign: z.enum(keys(HEADER_ALIGNS)),
    headerBackground: z.enum(keys(HEADER_BACKGROUNDS)),
  }),
  productCards: z.object({
    image: z.enum(keys(CARD_IMAGES)),
    style: z.enum(keys(CARD_STYLES)),
    align: z.enum(keys(CARD_ALIGNS)),
  }),
  breakpoints: breakpointsSchema.optional(),
  elements: themeElementsSchema.optional(),
  library: colourLibrarySchema.optional(),
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
      visitorSwitch: false,
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
      breakpoints: DEFAULT_BREAKPOINTS,
    },
  },
  warm: {
    name: "Warm classic",
    description: "Cream paper and terracotta, Playfair Display headings over Lora, softly rounded bordered cards and a centred logo.",
    settings: {
      mode: "light",
      visitorSwitch: false,
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
      breakpoints: DEFAULT_BREAKPOINTS,
    },
  },
  bold: {
    name: "Bold modern",
    description: "High contrast: a black header, square corners, a bright orange accent, Archivo headings in spaced capitals and edge-to-edge product pictures.",
    settings: {
      mode: "auto",
      visitorSwitch: false,
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
      breakpoints: DEFAULT_BREAKPOINTS,
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
  const stored: Record<string, unknown> = isPlain(value) ? { ...value } : {};
  // Widths that cannot be used fall back to the template's alone (D179), never the whole theme.
  const given = isPlain(stored.settings) ? stored.settings : undefined;
  if (given && given.breakpoints !== undefined && !breakpointsSchema.safeParse(given.breakpoints).success) {
    const { breakpoints, ...rest } = given;
    void breakpoints;
    stored.settings = rest;
  }
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
 * storefront's classes read, and its sizes. The store's mode sets the
 * colours (light, dark, or each by the visitor's device); a visitor's own
 * choice (D99, `data-color-mode` on the element or around it, where it has
 * no mode of its own) takes the other set. `preview` shows one set only,
 * for the admin's preview. Every value comes from the validated settings,
 * never from free text.
 */
export function themeCss(settings: ThemeSettings, selector: string, preview?: "light" | "dark"): string {
  const sizes = [
    `--button-radius: ${BUTTON_RADIUS[settings.buttons.corners]}`,
    `--radius-lg: ${CARD_RADIUS[settings.corners.cards]}`,
    `--radius-md: ${FIELD_RADIUS[settings.corners.fields]}`,
    `--content-width: ${settings.layout.maxWidth ? `${settings.layout.maxWidth}px` : WIDTH[settings.layout.width]}`,
    `--card-aspect: ${ASPECT[settings.productCards.image]}`,
    `--heading-weight: ${HEADING_WEIGHTS[settings.headings.weight]}`,
  ].join("; ");
  const colors = (scheme: "light" | "dark") => paletteVars(settings[scheme], scheme);
  if (preview) return `${selector} { ${colors(preview)}; ${sizes}; }`;
  const base = settings.mode === "dark" ? "dark" : "light";
  const other = base === "dark" ? "light" : "dark";
  let css = `${selector} { ${colors(base)}; ${sizes}; }`;
  if (settings.mode === "auto") {
    css += `\n@media (prefers-color-scheme: dark) { ${selector}:not([data-color-mode="light"], [data-color-mode="light"] *) { ${colors("dark")}; } }`;
  }
  css += `\n${selector}[data-color-mode="${other}"], :where([data-color-mode="${other}"]) ${selector}:not([data-color-mode]) { ${colors(other)}; }`;
  return css;
}

/**
 * The data attributes globals.css draws a theme's choices from, on `<html>`
 * (or the preview's box); a store always light or dark says so, so that
 * everything drawn by the device's mode (`dark:`) follows it too (D99).
 */
export function themeAttributes(settings: ThemeSettings): Record<string, string> {
  return {
    "data-store-theme": "",
    "data-button-style": settings.buttons.style,
    "data-heading-case": settings.headings.case,
    "data-card-style": settings.productCards.style,
    "data-card-align": settings.productCards.align,
    ...(settings.mode !== "auto" && { "data-color-mode": settings.mode }),
  };
}

// ---------------------------------------------------------------------------
// The page builder's Theme tab (D182)
// ---------------------------------------------------------------------------

/**
 * What the page builder's Theme tab edits of a theme (`src/lib/theme-elements.ts`): the elements, the content width in
 * pixels over the Narrow, Normal and Wide choice (null: the choice), and the body background of each colour set.
 */
export type ThemeTabValue = { elements: ThemeElements; maxWidth: number | null; background: { light: string; dark: string } };

export const themeTabValue = (settings: ThemeSettings): ThemeTabValue => ({
  elements: structuredClone(settings.elements ?? {}),
  maxWidth: settings.layout.maxWidth ?? null,
  background: { light: settings.light.background, dark: settings.dark.background },
});

/** The theme with the tab's value in it, and nothing else changed. */
export function withThemeTab(settings: ThemeSettings, value: ThemeTabValue): ThemeSettings {
  const { elements: _before, ...rest } = settings;
  void _before;
  const { maxWidth: _width, ...layout } = settings.layout;
  void _width;
  return {
    ...rest,
    layout: { ...layout, ...(value.maxWidth !== null && { maxWidth: value.maxWidth }) },
    light: { ...settings.light, background: value.background.light },
    dark: { ...settings.dark, background: value.background.dark },
    ...(Object.keys(value.elements).length > 0 && { elements: value.elements }),
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
  // Both sets show where the device decides or the visitor may choose (D99).
  const sets = settings.mode === "auto" || settings.visitorSwitch ? (["light", "dark"] as const) : ([settings.mode] as const);
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

// ---------------------------------------------------------------------------
// Logos on dark backgrounds
// ---------------------------------------------------------------------------

/** Where a logo sits: the header, or on the page itself (the footer, the phone's menu). */
export type LogoPlace = "header" | "page";

/** Whether white text reads better on a colour than black does. */
export const isDarkColor = (color: string) => contrastRatio(color, "#ffffff") > contrastRatio(color, "#000000");

function behindLogo(settings: ThemeSettings, place: LogoPlace, set: Palette): string {
  if (place === "page") return set.background;
  switch (settings.layout.headerBackground) {
    case "surface":
      return set.surface;
    case "accent":
      return set.accent;
    case "inverse":
      return set.text;
    default:
      return set.background;
  }
}

/**
 * Whether the colour behind a logo is dark in the theme's light colours and
 * in its dark ones (whichever the page shows: the store's mode, the
 * device's or the visitor's choice, D99): where it is, a store's logo for
 * dark backgrounds takes the place of its logo (D60).
 */
export function darkBehindLogo(settings: ThemeSettings, place: LogoPlace): { light: boolean; dark: boolean } {
  return {
    light: isDarkColor(behindLogo(settings, place, settings.light)),
    dark: isDarkColor(behindLogo(settings, place, settings.dark)),
  };
}
