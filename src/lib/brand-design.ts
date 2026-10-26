import { z } from "zod";

import {
  BUTTON_CORNERS,
  BUTTON_STYLES,
  CARD_CORNERS,
  CARD_IMAGES,
  CARD_STYLES,
  COLOR_MODES,
  CONTENT_WIDTHS,
  contrastRatio,
  FIELD_CORNERS,
  HEADER_ALIGNS,
  HEADER_BACKGROUNDS,
  HEADING_CASES,
  HEADING_WEIGHTS,
  THEME_TEMPLATE_KEYS,
  type Palette,
  type StoreTheme,
  type ThemeSettings,
} from "./theme";

/**
 * A look of the store's own (D330, `docs/ai-autopilot.md` 14.2): the model gives a few brand colours, fonts and named choices; this works
 * out every colour of both palettes and holds each pair the theme checker reads (`themeWarnings()`) to 4.5:1, so a designed look is always
 * readable. Pure.
 */

/** Text and secondary text against their backgrounds, and text on the accent: the checker's line. */
export const READABLE = 4.5;
/** The main text aims higher. */
export const MAIN_TEXT = 7;
/** An accent seen against the dark background (a button's edge, a link) aims for this. */
export const ACCENT_ON_DARK = 3;

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "A colour is # and six hex digits, like #1f6f5c.")
  .transform((v) => v.toLowerCase());
const keys = <T extends Record<string, unknown>>(record: T) => Object.keys(record) as [keyof T & string, ...(keyof T & string)[]];
const family = z.string().trim().min(1).max(100);

export const designLookInput = z.object({
  title: z.string().trim().min(1).max(60).describe("The look's name in the theme library, such as 'Fjord – our own'."),
  start: z.enum(["current", ...THEME_TEMPLATE_KEYS]).default("current").describe("Start from the live look (current) or a built-in template: minimal, warm or bold."),
  accent: hex.describe("The brand's main colour, for buttons and highlights."),
  background: hex.optional().describe("The page background of the light colours (or of the dark ones when mode is dark)."),
  text: hex.optional().describe("The main text colour over that background."),
  mode: z.enum(keys(COLOR_MODES)).optional().describe("auto follows the visitor's device; light or dark always."),
  heading_font: family.optional().describe("A font family from Google Fonts' catalogue for headings, such as 'Fraunces'."),
  body_font: family.optional().describe("A font family from Google Fonts' catalogue for text, such as 'Inter'."),
  heading_weight: z.enum(keys(HEADING_WEIGHTS)).optional(),
  heading_case: z.enum(keys(HEADING_CASES)).optional().describe("normal, or upper for spaced capitals."),
  button_style: z.enum(keys(BUTTON_STYLES)).optional(),
  button_corners: z.enum(keys(BUTTON_CORNERS)).optional(),
  card_corners: z.enum(keys(CARD_CORNERS)).optional(),
  field_corners: z.enum(keys(FIELD_CORNERS)).optional(),
  width: z.enum(keys(CONTENT_WIDTHS)).optional(),
  header_align: z.enum(keys(HEADER_ALIGNS)).optional(),
  header_background: z.enum(keys(HEADER_BACKGROUNDS)).optional(),
  card_image: z.enum(keys(CARD_IMAGES)).optional(),
  card_style: z.enum(keys(CARD_STYLES)).optional(),
});
export type DesignLookInput = z.infer<typeof designLookInput>;

// Colour arithmetic ---------------------------------------------------------------------------------------------------------------------

const rgb = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

/** `a` moved toward `b` by `t` (0 to 1). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

const WHITE = "#ffffff";
const INK = "#111111";
const isDark = (c: string) => contrastRatio(c, WHITE) > contrastRatio(c, "#000000");

/**
 * `colour` moved step by step toward black or white, whichever reads better against `against`, until it reaches `min`; the end colour
 * itself when even that cannot (never short of what black or white gives).
 */
export function readableOn(colour: string, against: string, min: number): string {
  if (contrastRatio(colour, against) >= min) return colour;
  const end = contrastRatio(WHITE, against) >= contrastRatio("#000000", against) ? WHITE : "#000000";
  for (let t = 0.05; t < 1; t += 0.05) {
    const next = mix(colour, end, t);
    if (contrastRatio(next, against) >= min) return next;
  }
  return end;
}

/** The text on an accent and the accent itself, adjusted until they read: white or near black, whichever is better, and the accent moved if needed. */
export function onAccent(accent: string): { accent: string; text: string } {
  const text = contrastRatio(WHITE, accent) >= contrastRatio(INK, accent) ? WHITE : INK;
  if (contrastRatio(text, accent) >= READABLE) return { accent, text };
  // Move the accent away from its text: darker under white, lighter under ink.
  const away = text === WHITE ? "#000000" : WHITE;
  for (let t = 0.05; t < 1; t += 0.05) {
    const next = mix(accent, away, t);
    if (contrastRatio(text, next) >= READABLE) return { accent: next, text };
  }
  return { accent: away, text };
}

/** A whole palette from a background, a text colour and an accent, every pair the checker reads at 4.5:1 or more. */
export function paletteFrom(background: string, text: string, accent: string, dark: boolean): Palette {
  const first = readableOn(text, background, MAIN_TEXT);
  const surface = surfaceFor(background, first, dark);
  // Moving the text toward black or white only ever raises its contrast with both grounds, so the second move keeps the first's.
  const main = readableOn(readableOn(first, surface, READABLE), background, MAIN_TEXT);
  const muted = readableOn(mix(main, background, 0.35), background, READABLE);
  const border = mix(background, main, dark ? 0.16 : 0.12);
  const seen = dark ? readableOn(accent, background, ACCENT_ON_DARK) : accent;
  const { accent: finalAccent, text: accentText } = onAccent(seen);
  return { background, surface, text: main, muted, border, accent: finalAccent, accentText };
}

/**
 * Panels' colour: the background moved a little toward the text, as themes draw it. On a mid-bright background that leaves the text too
 * little contrast, so it moves away from the text instead, or stays the background.
 */
function surfaceFor(background: string, text: string, dark: boolean): string {
  const toward = mix(background, text, dark ? 0.07 : 0.04);
  if (contrastRatio(text, toward) >= READABLE) return toward;
  const away = mix(background, contrastRatio(WHITE, text) > contrastRatio("#000000", text) ? WHITE : "#000000", 0.05);
  return contrastRatio(text, away) >= READABLE ? away : background;
}

/** The dark set's background and text, tinted a little with the accent. */
const darkGround = (accent: string) => ({ background: mix("#0e0e10", accent, 0.06), text: mix("#f5f5f5", accent, 0.03) });

/**
 * The designed theme: the base (the live look or a template) with the brand's colours worked into both palettes, its fonts and its named
 * choices laid over. The colours given are the light set's, or the dark set's when the mode is dark; the other set is worked out.
 */
export function designedTheme(base: ThemeSettings, input: DesignLookInput): ThemeSettings {
  const mode = input.mode ?? base.mode;
  const darkFirst = mode === "dark";
  const given = darkFirst ? base.dark : base.light;
  const background = input.background ?? given.background;
  const text = input.text ?? (isDark(background) === isDark(given.background) ? given.text : isDark(background) ? "#f5f5f5" : INK);
  const own = paletteFrom(background, text, input.accent, isDark(background));
  const other = darkFirst
    ? paletteFrom(base.light.background, base.light.text, input.accent, false)
    : (() => {
        const ground = darkGround(input.accent);
        return paletteFrom(ground.background, ground.text, input.accent, true);
      })();
  return {
    ...base,
    mode,
    light: darkFirst ? other : own,
    dark: darkFirst ? own : other,
    fonts: { heading: input.heading_font ?? base.fonts.heading, body: input.body_font ?? base.fonts.body },
    headings: { weight: input.heading_weight ?? base.headings.weight, case: input.heading_case ?? base.headings.case },
    buttons: { style: input.button_style ?? base.buttons.style, corners: input.button_corners ?? base.buttons.corners },
    corners: { cards: input.card_corners ?? base.corners.cards, fields: input.field_corners ?? base.corners.fields },
    layout: {
      ...base.layout,
      width: input.width ?? base.layout.width,
      headerAlign: input.header_align ?? base.layout.headerAlign,
      headerBackground: input.header_background ?? base.layout.headerBackground,
    },
    productCards: { ...base.productCards, image: input.card_image ?? base.productCards.image, style: input.card_style ?? base.productCards.style },
  };
}

/** The store theme the install keeps: the base's template, no saved theme, the designed settings. */
export const designedStoreTheme = (base: StoreTheme, settings: ThemeSettings): StoreTheme => ({ base: base.base, savedId: null, settings });
