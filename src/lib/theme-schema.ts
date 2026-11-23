import { z } from "zod";

import { themeHoverSchema } from "./hover-timing-schema";
import { breakpointsSchema } from "./breakpoints-schema";
import { fontFamily } from "./fonts-schema";
import { CONTENT_MAX_MAX, CONTENT_MAX_MIN } from "./content-width";
import { colourLibrarySchema } from "./colour-library-schema";
import { sectionStylesSchema, themeElementsSchema } from "./theme-elements";
import {
  BUTTON_CORNERS,
  BUTTON_STYLES,
  CARD_ALIGNS,
  CARD_CORNERS,
  CARD_IMAGES,
  CARD_STYLES,
  CHECKOUT_BACKGROUNDS,
  CHECKOUT_FIELDS,
  COLOR_MODES,
  CONSENT_COLOUR_KEYS,
  CONSENT_HEADINGS,
  CONSENT_SCHEMES,
  CONSENT_SHADOWS,
  type ConsentColourKey,
  type ConsentLook,
  CONTENT_WIDTHS,
  type CheckoutLook,
  FIELD_CORNERS,
  HEADER_ALIGNS,
  HEADER_BACKGROUNDS,
  HEADING_CASES,
  HEADING_WEIGHTS,
  PALETTE_KEYS,
  type PaletteKey,
  type StoreTheme,
  THEME_TEMPLATE_KEYS,
  type ThemeSettings,
  type ThemeTemplate,
  templateSettings,
} from "./theme";

/**
 * A store's theme as it is checked and read (bloat review step 2.46): the settings' schemas and parseStoreTheme(), apart from the
 * templates, labels and CSS in theme.ts, so a screen that only reads a template or a label loads no zod. Import this file only where
 * a schema runs; theme.ts imports it as a type alone.
 */

const keys = <T extends Record<string, unknown>>(record: T) => Object.keys(record) as [keyof T & string, ...(keyof T & string)[]];
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits, like #1f2937.").transform((v) => v.toLowerCase());
const palette = z.object(Object.fromEntries(PALETTE_KEYS.map((key) => [key, hex])) as Record<PaletteKey, typeof hex>);
const optionalFamily = z.preprocess((v) => (v === "" || v === null ? undefined : v), fontFamily.optional());

export const checkoutLookSchema = z.object({
  mark: z.boolean().optional(),
  background: z.enum(keys(CHECKOUT_BACKGROUNDS)).optional(),
  button: z.object({ light: hex, dark: hex }).optional(),
  corners: z.enum(keys(BUTTON_CORNERS)).optional(),
  fields: z.enum(keys(CHECKOUT_FIELDS)).optional(),
}) satisfies z.ZodType<CheckoutLook, unknown>;

const consentColours = z.object(Object.fromEntries(CONSENT_COLOUR_KEYS.map((key) => [key, hex])) as Record<ConsentColourKey, typeof hex>);

/** The cookie popup's look (D883). */
export const consentLookSchema = z.object({
  scheme: z.enum(keys(CONSENT_SCHEMES)).optional(),
  colours: z.object({ light: consentColours, dark: consentColours }).optional(),
  corners: z.enum(keys(CARD_CORNERS)).optional(),
  buttonCorners: z.enum(keys(BUTTON_CORNERS)).optional(),
  heading: z.enum(keys(CONSENT_HEADINGS)).optional(),
  shadow: z.enum(keys(CONSENT_SHADOWS)).optional(),
}) satisfies z.ZodType<ConsentLook, unknown>;

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
  sectionStyles: sectionStylesSchema,
  library: colourLibrarySchema.optional(),
  hover: themeHoverSchema,
  checkout: checkoutLookSchema.optional(),
  consent: consentLookSchema.optional(),
}) satisfies z.ZodType<ThemeSettings, unknown>;

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
