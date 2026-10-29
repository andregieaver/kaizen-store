/**
 * Text styles (D393, `docs/text-styles.md`): named looks for words, made from a gallery look's settings or, under Advanced, from the
 * owner's own declarations, and drawn as one CSS rule per style on the class `ts-{slug}`. Pure and without zod (the schema is
 * `text-styles-schema.ts`): every declaration a style becomes is written here by code from checked values, or kept from the owner's
 * own by `cleanStyleDeclarations()`'s closed list of text properties.
 */

export const TEXT_STYLE_KINDS = ["gradient", "highlight", "outline", "underline", "glow", "colour", "smallCaps", "spacedCaps", "custom"] as const;
export type TextStyleKind = (typeof TEXT_STYLE_KINDS)[number];

/** The looks of the gallery, in the order shown (`custom` is reached by *Advanced*). */
export const GALLERY_KINDS = TEXT_STYLE_KINDS.filter((kind) => kind !== "custom");

export const UNDERLINE_STYLES = ["solid", "wavy", "dotted", "double"] as const;
export type UnderlineStyle = (typeof UNDERLINE_STYLES)[number];
export const HIGHLIGHT_HEIGHTS = ["low", "full"] as const;
export type HighlightHeight = (typeof HIGHLIGHT_HEIGHTS)[number];
export const FONT_WEIGHTS = [400, 500, 600, 700, 800, 900] as const;

/** A style's settings: what its look takes (each kind reads its own keys; the rest are ignored). */
export type TextStyleSettings = {
  /** Gradient: two or three colours; every other look one. `#rrggbb`. */
  colors?: string[];
  color?: string;
  /** Gradient's direction in degrees. */
  angle?: number;
  /** Outline's and underline's thickness in pixels; glow's size in pixels. */
  size?: number;
  underline?: UnderlineStyle;
  highlight?: HighlightHeight;
  weight?: (typeof FONT_WEIGHTS)[number];
  /** Spaced capitals' letter spacing in hundredths of an em. */
  spacing?: number;
};

export type TextStyle = {
  /** Fixed once made: the class is `ts-{slug}`. */
  slug: string;
  name: string;
  kind: TextStyleKind;
  settings: TextStyleSettings;
  /** `custom` only: the owner's own declarations, as kept by `cleanStyleDeclarations()`. */
  css: string | null;
};

export const TEXT_STYLES_MAX = 50;
export const TEXT_STYLE_NAME_MAX = 60;
export const TEXT_STYLE_CSS_MAX = 2000;
export const SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const CLASS_PREFIX = "ts-";

/** The class a style is drawn on. */
export const textStyleClass = (slug: string): string => `${CLASS_PREFIX}${slug}`;
/** The slug a class names, or null when it is not a style's class. */
export function slugOfClass(className: string): string | null {
  if (!className.startsWith(CLASS_PREFIX)) return null;
  const slug = className.slice(CLASS_PREFIX.length);
  return SLUG_SHAPE.test(slug) ? slug : null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (value: unknown, fallback: string): string => (typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback);
const within = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** What a new style of a kind starts from: the theme's accent and text colours where it takes colours. */
export function starterSettings(kind: TextStyleKind, theme: { accent: string; text: string }): TextStyleSettings {
  const accent = hex(theme.accent, "#2563eb");
  switch (kind) {
    case "gradient":
      return { colors: [accent, "#9333ea"], angle: 90 };
    case "highlight":
      return { color: "#fde047", highlight: "low" };
    case "outline":
      return { color: hex(theme.text, "#111111"), size: 1 };
    case "underline":
      return { color: accent, underline: "wavy", size: 2 };
    case "glow":
      return { color: accent, size: 8 };
    case "colour":
      return { color: accent, weight: 700 };
    case "spacedCaps":
      return { spacing: 12 };
    default:
      return {};
  }
}

/** The name a new style of a kind gets until the person names it. */
export const KIND_NAMES: Record<TextStyleKind, string> = {
  gradient: "Gradient text",
  highlight: "Highlighter",
  outline: "Outline",
  underline: "Underline",
  glow: "Glow",
  colour: "Colour",
  smallCaps: "Small caps",
  spacedCaps: "Spaced capitals",
  custom: "My style",
};

/** A style's declarations, as `property: value` pairs, written by code from its checked settings (or kept from its own CSS). */
export function textStyleDeclarations(style: Pick<TextStyle, "kind" | "settings" | "css">): [string, string][] {
  const s = style.settings;
  switch (style.kind) {
    case "gradient": {
      const colors = (s.colors ?? []).filter((c) => HEX.test(c)).slice(0, 3).map((c) => c.toLowerCase());
      const stops = colors.length >= 2 ? colors : ["#2563eb", "#9333ea"];
      return [
        // The first colour is the words' own, where the gradient cannot be drawn and for the contrast checker.
        ["color", stops[0]],
        ["background-image", `linear-gradient(${within(s.angle, 0, 360, 90)}deg, ${stops.join(", ")})`],
        ["-webkit-background-clip", "text"],
        ["background-clip", "text"],
        ["-webkit-text-fill-color", "transparent"],
        ["-webkit-box-decoration-break", "clone"],
        ["box-decoration-break", "clone"],
      ];
    }
    case "highlight": {
      const color = hex(s.color, "#fde047");
      const from = s.highlight === "full" ? "0%" : "55%";
      return [
        ["background-image", `linear-gradient(transparent ${from}, ${color} ${from})`],
        ["padding", "0 0.1em"],
        ["-webkit-box-decoration-break", "clone"],
        ["box-decoration-break", "clone"],
      ];
    }
    case "outline": {
      const color = hex(s.color, "#111111");
      return [
        ["color", color],
        ["-webkit-text-stroke", `${within(s.size, 1, 4, 1)}px ${color}`],
        ["-webkit-text-fill-color", "transparent"],
      ];
    }
    case "underline":
      return [
        ["text-decoration-line", "underline"],
        ["text-decoration-color", hex(s.color, "#2563eb")],
        ["text-decoration-style", UNDERLINE_STYLES.includes(s.underline as UnderlineStyle) ? (s.underline as string) : "solid"],
        ["text-decoration-thickness", `${within(s.size, 1, 8, 2)}px`],
        ["text-underline-offset", "0.2em"],
      ];
    case "glow": {
      const color = hex(s.color, "#2563eb");
      const size = within(s.size, 2, 30, 8);
      return [["text-shadow", `0 0 ${size}px ${color}, 0 0 ${size * 2}px ${color}`]];
    }
    case "colour":
      return [
        ["color", hex(s.color, "#2563eb")],
        ["font-weight", String(FONT_WEIGHTS.includes(s.weight as (typeof FONT_WEIGHTS)[number]) ? s.weight : 700)],
      ];
    case "smallCaps":
      return [
        ["font-variant-caps", "all-small-caps"],
        ["letter-spacing", "0.05em"],
      ];
    case "spacedCaps":
      return [
        ["text-transform", "uppercase"],
        ["letter-spacing", `${within(s.spacing, 5, 50, 12) / 100}em`],
      ];
    case "custom":
      return cleanStyleDeclarations(style.css ?? "").declarations;
  }
}

/** The properties a style's own CSS may set: text only, so a style can never move or hide a part of the page. */
export const STYLE_PROPERTIES = new Set([
  "color",
  "background-color",
  "background-image",
  "background-clip",
  "-webkit-background-clip",
  "-webkit-text-fill-color",
  "-webkit-text-stroke",
  "-webkit-text-stroke-color",
  "-webkit-text-stroke-width",
  "text-decoration",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-style",
  "text-decoration-thickness",
  "text-underline-offset",
  "text-shadow",
  "text-transform",
  "font-weight",
  "font-style",
  "font-variant",
  "font-variant-caps",
  "letter-spacing",
  "word-spacing",
  "padding",
  "border-radius",
  "box-decoration-break",
  "-webkit-box-decoration-break",
  "opacity",
]);

/** A value that could reach outside the rule or load something: refused whole. */
const UNSAFE_VALUE = /url\s*\(|expression\s*\(|@|[{}<>;\\]|\/\*|javascript:/i;
/** A background is a colour or a linear gradient of colours, nothing that loads. */
const BACKGROUND_VALUE = /^(?:(?:repeating-)?linear-gradient\([#\w\s.,%()-]*\)|#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;
const DECLARATION_MAX = 300;

/**
 * The owner's own declarations as kept: `property: value` pairs of `STYLE_PROPERTIES` with a safe value, each at most 300
 * characters; `!important` is dropped (a style is one class, the page's own CSS can still say otherwise). What was left out is named.
 */
export function cleanStyleDeclarations(css: string): { declarations: [string, string][]; dropped: string[] } {
  const declarations: [string, string][] = [];
  const dropped: string[] = [];
  const body = css.slice(0, TEXT_STYLE_CSS_MAX).replace(/^\s*\.[\w-]+\s*\{/, "").replace(/\}\s*$/, "");
  for (const raw of body.split(/;|\n/)) {
    const text = raw.trim();
    if (!text) continue;
    const colon = text.indexOf(":");
    if (colon <= 0) {
      dropped.push(text.slice(0, 60));
      continue;
    }
    const property = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).replace(/!important\s*$/i, "").trim();
    const safe =
      STYLE_PROPERTIES.has(property) &&
      value !== "" &&
      text.length <= DECLARATION_MAX &&
      !UNSAFE_VALUE.test(value) &&
      (!property.startsWith("background-") || property === "background-clip" || BACKGROUND_VALUE.test(value));
    if (safe) declarations.push([property, value]);
    else dropped.push(property || text.slice(0, 60));
  }
  return { declarations, dropped };
}

/** One style's rule. */
export function textStyleRule(style: Pick<TextStyle, "slug" | "kind" | "settings" | "css">, scope = ""): string {
  if (!SLUG_SHAPE.test(style.slug)) return "";
  const body = textStyleDeclarations(style)
    .map(([property, value]) => `${property}:${value}`)
    .join(";");
  return body ? `${scope}.${textStyleClass(style.slug)}{${body}}` : "";
}

/** The site's stylesheet of styles: one rule per style, in the library's order (`scope` limits it to a box, as the menu's previews). */
export function textStylesCss(styles: readonly Pick<TextStyle, "slug" | "kind" | "settings" | "css">[], scope = ""): string {
  return styles
    .map((style) => textStyleRule(style, scope ? `${scope} ` : ""))
    .filter(Boolean)
    .join("\n");
}

/** A slug for a name, unique among those taken: lower-case letters, digits and hyphens. */
export function slugFor(name: string, taken: Iterable<string>): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/æ/g, "ae")
      .replace(/ø/g, "o")
      .replace(/å/g, "a")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
      .replace(/-+$/, "") || "style";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const next = `${base}-${n}`;
    if (!used.has(next)) return next;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** The slugs of styles a text names through inline markup's classes (`<span class="ts-…">`), for where a style is used. */
export function stylesInMarkup(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/class\s*=\s*["']([^"']*)["']|<span\s*=\s*"([^"]*)"/g)) {
    for (const name of (match[1] ?? match[2] ?? "").split(/\s+/)) {
      const slug = slugOfClass(name);
      if (slug) found.add(slug);
    }
  }
  return [...found];
}
