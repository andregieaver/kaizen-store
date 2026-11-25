import { z } from "zod";

import { designedTheme, paletteFrom, type DesignLookInput } from "./brand-design";
import { libraryName, SAVED_COLOURS_MAX, withSavedColour, type ColourLibrary } from "./colour-library";
import type { HeadingWeight, ThemeSettings } from "./theme";
import type { ThemeElement } from "./part-styles";
import type { ThemeElementKey, ThemeElements } from "./theme-elements";
import type { TextWeight, Typography, TypographyOverride } from "./typography";

/**
 * A look from a Figma file (D898 F3, `docs/design-tools.md`): the file's colour styles and colour variables, and its text styles, as the
 * Kaizena Flow plugin reads them, become a theme's settings. The colours named for the brand, the page and its text go into both palettes
 * through `designedTheme()` and `paletteFrom()`, so every pair the checker reads (`themeWarnings()`) is readable; a dark mode of the file's
 * variables is the dark palette. The heading and body typefaces are the theme's fonts, each text style named for a heading level, a paragraph
 * or a button is that element's typography (`ThemeSettings.elements`), and every colour is a saved colour. Pure; the caller installs the
 * typefaces and keeps the look, not live.
 */

const FIGMA_COLOURS_MAX = 300;
const FIGMA_TEXT_STYLES_MAX = 100;

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((v) => v.toLowerCase());
const name = z.string().trim().min(1).max(120);

const figmaColour = z.object({
  name,
  color: hex,
  /** A variable's mode by its name (`Light`, `Dark`, `Mode 1`); a style has none. */
  mode: z.string().trim().max(60).nullable().optional(),
  /** Whether the mode is its collection's first, the one Figma shows unless told otherwise. */
  main: z.boolean().optional(),
});
const figmaTextStyle = z.object({
  name,
  family: z.string().trim().min(1).max(100),
  /** Figma's style of the family: `Regular`, `Semi Bold`, `Bold Italic`. */
  style: z.string().trim().max(60).default("Regular"),
  size: z.number().min(1).max(400),
  /** Its line height in pixels; none: the typeface's own. */
  line: z.number().min(1).max(400).nullable().optional(),
  /** Its letter spacing in pixels. */
  tracking: z.number().min(-20).max(100).optional(),
  upper: z.boolean().optional(),
});
export const figmaLook = z.object({
  colours: z.array(figmaColour).max(FIGMA_COLOURS_MAX),
  text: z.array(figmaTextStyle).max(FIGMA_TEXT_STYLES_MAX),
});
export type FigmaColour = z.infer<typeof figmaColour>;
export type FigmaTextStyle = z.infer<typeof figmaTextStyle>;
export type FigmaLook = z.infer<typeof figmaLook>;

// Names ----------------------------------------------------------------------------------------------------------------------------------

/** A name's words, lower case: `Brand/Primary 500` and `colorBackgroundDefault` read alike. */
export const nameWords = (text: string): string[] =>
  text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

type Role = "accent" | "background" | "text";

const ROLE_WORDS: Record<Role, readonly string[]> = {
  accent: ["primary", "brand", "accent", "action", "cta", "main", "interactive", "highlight"],
  background: ["background", "bg", "canvas", "page", "backdrop"],
  text: ["text", "foreground", "fg", "ink", "copy", "body"],
};
/** A colour named for a state, a line or a message is not the brand's, the page's or its text. */
const SIDE_WORDS = new Set([
  "hover",
  "pressed",
  "active",
  "focus",
  "disabled",
  "subtle",
  "muted",
  "secondary",
  "tertiary",
  "border",
  "outline",
  "stroke",
  "divider",
  "error",
  "danger",
  "success",
  "warning",
  "info",
  "overlay",
  "shadow",
  "inverse",
  "inverted",
  "placeholder",
  "light",
  "lighter",
  "dark",
  "darker",
  "weak",
  "strong",
]);
/** Words of a group, a scale or a set, not of a role. */
const FILLER = new Set(["color", "colour", "colors", "colours", "default", "token", "tokens", "semantic", "theme", "mode", "sys", "ref", "base"]);
/** A name with one of these is a part's colour, not the brand's: `Surface/Primary` is a panel's. */
const NOT_ACCENT = new Set(["surface", "card", "panel", "neutral", "gray", "grey", "white", "black", "icon", "fill"]);

const DARK_MODE = /\b(dark|night|dim|mørk)\b/i;

/**
 * Whether a colour belongs to the dark palette: a variable's dark mode, or a style in a group named Dark (`Dark/Background`,
 * `Theme/Dark/Text`). A last word Dark is a shade (`Primary/Dark`), not the palette.
 */
export function isDarkColour(colour: FigmaColour): boolean {
  if (colour.mode) return DARK_MODE.test(colour.mode);
  const words = nameWords(colour.name);
  const at = words.indexOf("dark");
  return at >= 0 && at < words.length - 1;
}

/** Whether a colour belongs to the light palette: a light mode, a collection's first mode, or a style outside a Dark group. */
const isLightColour = (colour: FigmaColour) => (colour.mode ? !DARK_MODE.test(colour.mode) && (/\blight\b/i.test(colour.mode) || colour.main !== false) : !isDarkColour(colour));

/**
 * How well a name says the role: its last word scores most, an earlier one less, a longer name a little less. A state, a shade or a side
 * colour scores none, as does text *on* the brand; `Text/Primary` and `Background/Primary` are the text's and the page's, never the brand's.
 */
function roleScore(words: string[], role: Role): number {
  const last = words.length - 1;
  // A palette's group (`Light/…`, `Dark/…`) and a scale's step say nothing of the role.
  const own = words.filter((w, i) => !/^\d+$/.test(w) && !FILLER.has(w) && !((w === "light" || w === "dark") && i < last));
  if (own.some((w) => SIDE_WORDS.has(w))) return 0;
  const on = own.indexOf("on");
  if (on >= 0) {
    // `on-background`, `on surface`: the text over it. `on-primary`: the text on a button, worked out from the accent.
    return role === "text" && ["background", "surface", "bg", "page"].includes(own[on + 1] ?? "") ? 2 : 0;
  }
  const says = (r: Role) => own.some((w) => ROLE_WORDS[r].includes(w));
  if (role === "accent" && (says("text") || says("background") || own.some((w) => NOT_ACCENT.has(w)))) return 0;
  if (role === "text" && says("background")) return 0;
  if (role === "background" && says("text")) return 0;
  let best = 0;
  own.forEach((w, i) => {
    if (ROLE_WORDS[role].includes(w)) best = Math.max(best, i === own.length - 1 ? 3 : 2);
  });
  return best === 0 ? 0 : best - Math.min(own.length, 4) * 0.1;
}

/** The colour that best says the role, or none. */
function named(colours: FigmaColour[], role: Role): FigmaColour | undefined {
  let found: { colour: FigmaColour; score: number } | undefined;
  for (const colour of colours) {
    const score = roleScore(nameWords(colour.name), role);
    if (score > 0 && (!found || score > found.score)) found = { colour, score };
  }
  return found?.colour;
}

const channels = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255];
/** How colourful a colour is: its chroma, 0 for a grey, 1 for a pure hue. */
export const chroma = (c: string): number => {
  const [r, g, b] = channels(c);
  return Math.max(r, g, b) - Math.min(r, g, b);
};

export type Roles = { background?: FigmaColour; text?: FigmaColour; accent?: FigmaColour };

/** The brand's, the page's and the text's colours of each palette, by their names; the light accent is the most colourful when none is named. */
export function colourRoles(colours: FigmaColour[]): { light: Roles; dark: Roles; guessedAccent: boolean } {
  const lights = colours.filter(isLightColour);
  const darks = colours.filter(isDarkColour);
  const light: Roles = { background: named(lights, "background"), text: named(lights, "text"), accent: named(lights, "accent") };
  const dark: Roles = { background: named(darks, "background"), text: named(darks, "text"), accent: named(darks, "accent") };
  let guessedAccent = false;
  if (!light.accent) {
    // Never a state's or a message's colour (an error's red), nor one named for the text or the page.
    const guessable = (c: FigmaColour) => {
      const words = nameWords(c.name);
      return !words.some((w) => SIDE_WORDS.has(w) || ROLE_WORDS.text.includes(w) || ROLE_WORDS.background.includes(w));
    };
    const colourful = lights.filter((c) => guessable(c) && chroma(c.color) >= 0.25).sort((a, b) => chroma(b.color) - chroma(a.color))[0];
    if (colourful) {
      light.accent = colourful;
      guessedAccent = true;
    }
  }
  return { light, dark, guessedAccent };
}

// Type -----------------------------------------------------------------------------------------------------------------------------------

const WEIGHT_WORDS: [RegExp, TextWeight][] = [
  [/\b(thin|hairline)\b/, 100],
  [/\b(extra ?light|ultra ?light)\b/, 200],
  [/\blight\b/, 300],
  [/\bmedium\b/, 500],
  [/\b(semi ?bold|demi ?bold)\b/, 600],
  [/\b(extra ?bold|ultra ?bold)\b/, 800],
  [/\b(black|heavy)\b/, 900],
  [/\bbold\b/, 700],
];

/** A Figma style's weight from its name (`Semi Bold Italic` is 600); a plain or unknown one is 400. */
export function weightOf(style: string): TextWeight {
  const words = style.toLowerCase().replace(/[-_]/g, " ");
  for (const [pattern, weight] of WEIGHT_WORDS) if (pattern.test(words)) return weight;
  const number = /\b([1-9]00)\b/.exec(words);
  return number ? (Number(number[1]) as TextWeight) : 400;
}

const italic = (style: string) => /italic|oblique/i.test(style);

const HEADING_WORDS = ["heading", "headline", "display", "title", "hero"];
const BODY_WORDS = ["body", "paragraph", "p", "copy", "text"];
const BUTTON_WORDS = ["button", "btn", "cta"];

/** A heading level a name gives: `H2`, `Heading 2`, `heading/2`. */
function levelOf(words: string[]): number | null {
  for (let i = 0; i < words.length; i++) {
    const h = /^h([1-6])$/.exec(words[i]);
    if (h) return Number(h[1]);
    if ((words[i] === "heading" || words[i] === "headline") && /^[1-6]$/.test(words[i + 1] ?? "")) return Number(words[i + 1]);
  }
  return null;
}

const hasWord = (style: FigmaTextStyle, list: readonly string[]) => nameWords(style.name).some((w) => list.includes(w));

/** The style for each heading level, a paragraph and a button: by the name's level, then the other headings by size, largest first. */
export function textRoles(styles: FigmaTextStyle[]): Partial<Record<ThemeElementKey, FigmaTextStyle>> {
  const out: Partial<Record<ThemeElementKey, FigmaTextStyle>> = {};
  const unlevelled: FigmaTextStyle[] = [];
  for (const style of styles) {
    const level = levelOf(nameWords(style.name));
    const key = level ? (`h${level}` as ThemeElementKey) : null;
    if (key) out[key] ??= style;
    else if (hasWord(style, HEADING_WORDS)) unlevelled.push(style);
  }
  // `Heading/Large`, `Heading/Medium`, `Display`: the levels left, in order of size.
  const sizes = [...new Map(unlevelled.sort((a, b) => b.size - a.size).map((s) => [s.size, s])).values()];
  for (const key of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
    if (out[key]) continue;
    const next = sizes.shift();
    if (!next) break;
    out[key] = next;
  }
  const bodies = styles.filter((s) => hasWord(s, BODY_WORDS) && !hasWord(s, HEADING_WORDS) && !hasWord(s, BUTTON_WORDS) && levelOf(nameWords(s.name)) === null);
  const plain = bodies.length ? bodies : styles.filter((s) => s.size >= 12 && s.size <= 20 && !hasWord(s, HEADING_WORDS) && !hasWord(s, BUTTON_WORDS));
  // The paragraph is the one nearest 16 pixels, and of those the plainest weight.
  const p = [...plain].sort((a, b) => Math.abs(a.size - 16) - Math.abs(b.size - 16) || Math.abs(weightOf(a.style) - 400) - Math.abs(weightOf(b.style) - 400))[0];
  if (p) {
    out.p = p;
    out.list = p;
  }
  const button = styles.find((s) => hasWord(s, BUTTON_WORDS));
  if (button) out.button = button;
  return out;
}

/** The heading's and the body's styles: the theme's two typefaces come from them. */
export function fontRoles(styles: FigmaTextStyle[]): { heading?: FigmaTextStyle; body?: FigmaTextStyle } {
  const roles = textRoles(styles);
  const heading = roles.h1 ?? roles.h2 ?? [...styles].filter((s) => s.size >= 24).sort((a, b) => b.size - a.size)[0];
  return { heading, body: roles.p };
}

/** The typefaces to install, the most needed first: the heading's and the body's, then the others the elements use. */
export function figmaFamilies(look: FigmaLook): string[] {
  const fonts = fontRoles(look.text);
  const used = Object.values(textRoles(look.text)).map((s) => s.family);
  return [...new Set([fonts.heading?.family, fonts.body?.family, ...used].filter((f): f is string => Boolean(f)))];
}

const HEADING_WEIGHT_OF: [number, HeadingWeight][] = [
  [400, "normal"],
  [500, "medium"],
  [600, "semibold"],
  [700, "bold"],
];
const headingWeight = (weight: number): HeadingWeight =>
  HEADING_WEIGHT_OF.reduce((best, next) => (Math.abs(next[0] - weight) < Math.abs(best[0] - weight) ? next : best))[1];

/** Smaller screens: a large size is brought down, so a 64-pixel heading is not one word a line on a phone. */
const TABLET = { above: 40, factor: 0.8, least: 36 };
const PHONE = { above: 32, factor: 0.6, least: 28 };
const smaller = (size: number, at: typeof TABLET) => (size <= at.above ? null : Math.max(at.least, Math.round(size * at.factor)));

function typographyOf(style: FigmaTextStyle, family: string | null): Typography {
  return {
    ...(family ? { family } : {}),
    weight: weightOf(style.style),
    size: { value: Math.round(style.size), unit: "px" },
    ...(style.line ? { lineHeight: { value: Math.round(style.line), unit: "px" as const } } : {}),
    ...(style.tracking ? { letterSpacing: { value: Math.round(style.tracking * 100) / 100, unit: "px" as const } } : {}),
    ...(style.upper ? { transform: "uppercase" as const } : {}),
    ...(italic(style.style) ? { style: "italic" as const } : {}),
  };
}

function sizedDown(style: FigmaTextStyle, at: typeof TABLET): TypographyOverride | null {
  const size = smaller(style.size, at);
  if (!size) return null;
  const ratio = size / style.size;
  return { size: { value: size, unit: "px" }, ...(style.line ? { lineHeight: { value: Math.round(style.line * ratio), unit: "px" as const } } : {}) };
}

/** The elements with the file's text styles laid in: each one's typography and its smaller screens', the rest of the element as it was. */
export function elementsWith(base: ThemeElements | undefined, styles: FigmaTextStyle[], fonts: ReadonlyMap<string, string | null>): ThemeElements {
  const out: ThemeElements = { ...base };
  for (const [key, style] of Object.entries(textRoles(styles)) as [ThemeElementKey, FigmaTextStyle][]) {
    const was: ThemeElement = base?.[key] ?? {};
    const at = { ...was.at };
    for (const [size, rule] of [
      ["md", TABLET],
      ["sm", PHONE],
    ] as const) {
      const down = sizedDown(style, rule);
      const kept = { ...at[size] };
      // The size at a smaller screen is the file's, brought down, or the one for computers: an older one is not kept under it.
      const text: TypographyOverride = { ...kept.typography?.text };
      delete text.size;
      delete text.lineHeight;
      Object.assign(text, down);
      const groups = { ...kept.typography };
      if (Object.keys(text).length) groups.text = text;
      else delete groups.text;
      if (Object.keys(groups).length) kept.typography = groups;
      else delete kept.typography;
      at[size] = kept;
    }
    const cleanAt = Object.fromEntries(Object.entries(at).filter(([, v]) => v && Object.keys(v).length > 0));
    out[key] = {
      ...was,
      typography: { ...was.typography, text: typographyOf(style, fonts.get(style.family) ?? null) },
      ...(Object.keys(cleanAt).length ? { at: cleanAt } : {}),
    };
  }
  return out;
}

/**
 * The look's saved colours: the ones it had, then the file's (a dark mode's named so), each once. A saved colour of the same name takes the
 * file's value, so bringing a file again updates its colours rather than adding them twice; `left` did not fit.
 */
export function libraryWith(base: ColourLibrary | undefined, colours: FigmaColour[], newId: () => string): { library: ColourLibrary; left: number } {
  let library: ColourLibrary = { colours: [...(base?.colours ?? [])], gradients: [...(base?.gradients ?? [])] };
  let left = 0;
  const ordered = [...colours.filter((c) => !isDarkColour(c)), ...colours.filter(isDarkColour)];
  for (const colour of ordered) {
    const dark = isDarkColour(colour) && !nameWords(colour.name).includes("dark");
    const label = libraryName(dark ? `${colour.name} (dark)` : colour.name, colour.color);
    const same = library.colours.findIndex((c) => c.name === label);
    if (same >= 0) {
      library = { ...library, colours: library.colours.map((c, i) => (i === same ? { ...c, color: colour.color } : c)) };
      continue;
    }
    if (library.colours.length >= SAVED_COLOURS_MAX) {
      left += 1;
      continue;
    }
    library = withSavedColour(library, { id: newId(), name: label, color: colour.color }).library;
  }
  return { library, left };
}

// The look -------------------------------------------------------------------------------------------------------------------------------

export type FigmaLookResult = {
  settings: ThemeSettings;
  /** What became what, for the answer's notes. */
  found: {
    accent?: { name: string; color: string; guessed: boolean };
    background?: { name: string; color: string };
    text?: { name: string; color: string };
    dark: boolean;
    heading?: string;
    body?: string;
    elements: ThemeElementKey[];
    saved: number;
    left: number;
  };
};

/**
 * The theme's settings from the file: the base (the look it lays over) with the file's colours worked into both palettes (each readable),
 * its typefaces as `fonts` maps them (the installed family, or none when it could not be), its text styles as the elements' typography and
 * its colours saved. The light colours are given to `designedTheme()`; a dark mode's own background, text and accent make the dark palette.
 */
export function lookFromFigma(look: FigmaLook, base: ThemeSettings, fonts: ReadonlyMap<string, string | null>, newId: () => string = () => crypto.randomUUID()): FigmaLookResult {
  const roles = colourRoles(look.colours);
  const type = fontRoles(look.text);
  const hasLight = Boolean(roles.light.background || roles.light.text || roles.light.accent);
  const hasDark = Boolean(roles.dark.background);
  const mode = hasDark && hasLight ? "auto" : hasDark ? "dark" : base.mode === "dark" ? "light" : base.mode;
  const given = mode === "dark" ? roles.dark : roles.light;
  const accent = given.accent?.color ?? roles.light.accent?.color ?? (mode === "dark" ? base.dark.accent : base.light.accent);
  const headingFamily = type.heading ? fonts.get(type.heading.family) : null;
  const bodyFamily = type.body ? fonts.get(type.body.family) : null;
  const input: DesignLookInput = {
    title: "Figma",
    start: "current",
    accent,
    background: given.background?.color,
    text: given.text?.color,
    mode,
    heading_font: headingFamily ?? undefined,
    body_font: bodyFamily ?? undefined,
    heading_weight: type.heading ? headingWeight(weightOf(type.heading.style)) : undefined,
    heading_case: type.heading ? (type.heading.upper ? "upper" : "normal") : undefined,
  };
  let settings = designedTheme(base, input);
  // A file with no colour for the brand, the page or its text keeps the base's palettes as they were.
  if (!hasLight && !hasDark) settings = { ...settings, mode: base.mode, light: base.light, dark: base.dark };
  if (hasDark && hasLight && roles.dark.background) {
    const background = roles.dark.background.color;
    const text = roles.dark.text?.color ?? "#f5f5f5";
    settings = { ...settings, dark: paletteFrom(background, text, roles.dark.accent?.color ?? accent, true) };
  }
  const { library, left } = libraryWith(base.library, look.colours, newId);
  const elements = elementsWith(base.elements, look.text, fonts);
  settings = { ...settings, library, ...(Object.keys(elements).length ? { elements } : {}) };
  const textKeys = Object.keys(textRoles(look.text)) as ThemeElementKey[];
  return {
    settings,
    found: {
      accent: (given.accent ?? roles.light.accent) && { name: (given.accent ?? roles.light.accent)!.name, color: accent, guessed: !given.accent && roles.guessedAccent },
      background: given.background && { name: given.background.name, color: given.background.color },
      text: given.text && { name: given.text.name, color: given.text.color },
      dark: hasDark,
      heading: headingFamily ?? undefined,
      body: bodyFamily ?? undefined,
      elements: textKeys,
      saved: library.colours.length - (base.library?.colours.length ?? 0),
      left,
    },
  };
}
