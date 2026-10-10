import { z } from "zod";

import { SIZES, SMALLER_SIZES, type Size, type SmallerSize } from "./breakpoints";
import { colourCss, opacityValue } from "./colour";
import { fontFamily } from "./fonts";

/**
 * Typography (D179 phase 3, `docs/responsive-editing.md` 4 and 11): Beaver Builder's panel on every row, column and
 * component with text. A part holds a `Typography` per kind of text it has (`TextRole`: a heading's text, an accordion's
 * titles and bodies, a testimonial's quote and name, a grid tile's title, excerpt and price, a form's labels, …), as its
 * Extra large values in `PartBase.typography`, and per smaller size only what differs in `at.{size}.typography`, read
 * key by key from smaller to larger (`typographyAt()`). Everything is drawn by the part stylesheet (`src/lib/part-css.ts`),
 * never inline: `typographyRules()` gives each role's rules, on the element the role names (`textRoles()`), or on the
 * part itself for rows and columns, whose text inherits it.
 *
 * Settings saved before the panel (a heading's size, weight and alignment, a block's font, a grid's heading size and font,
 * an accordion's title size, a button's weight, rich text's and a product title's alignment) and the text colours kept on
 * their own before D180 (a heading's, a button's, each of a dual button's two, a grid's and a form's button's) are folded
 * into it on read (`foldTypography()`, run by `upgradeBlock()`), drawing exactly as before. Pure, for the browser and the
 * server.
 */

// ---------------------------------------------------------------------------
// The settings
// ---------------------------------------------------------------------------

export const FONT_SIZE_UNITS = ["px", "em", "rem", "%", "vw"] as const;
export type FontSizeUnit = (typeof FONT_SIZE_UNITS)[number];
/** A line height without a unit is a multiple of the text's size. */
export const LINE_HEIGHT_UNITS = ["", "px"] as const;
export type LineHeightUnit = (typeof LINE_HEIGHT_UNITS)[number];
export const LETTER_SPACING_UNITS = ["px", "em"] as const;
export type LetterSpacingUnit = (typeof LETTER_SPACING_UNITS)[number];

/** The weights a family may have; a font that lacks one shows its nearest. */
export const TEXT_WEIGHTS = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Normal",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
} as const;
export type TextWeight = keyof typeof TEXT_WEIGHTS;
export const TEXT_WEIGHT_VALUES = Object.keys(TEXT_WEIGHTS).map(Number) as TextWeight[];

export const TEXT_ALIGNS = { left: "Left", center: "Centre", right: "Right" } as const;
export type TypographyAlign = keyof typeof TEXT_ALIGNS;
/** Beaver's four: as written, Capitalised, CAPITALS, lower case. */
export const TEXT_TRANSFORMS = { none: "Normal", capitalize: "Tt", uppercase: "TT", lowercase: "tt" } as const;
export type TextTransform = keyof typeof TEXT_TRANSFORMS;
export const TEXT_TRANSFORM_NAMES: Record<TextTransform, string> = {
  none: "As written",
  capitalize: "Capitalise each word",
  uppercase: "Capitals",
  lowercase: "Lower case",
};
export const TEXT_DECORATIONS = { none: "None", underline: "Underline", overline: "Line over", "line-through": "Struck through" } as const;
export type TextDecoration = keyof typeof TEXT_DECORATIONS;
export const TEXT_STYLES = { normal: "Normal", italic: "Italic" } as const;
export type TextStyle = keyof typeof TEXT_STYLES;
export const TEXT_VARIANTS = { normal: "Normal", "small-caps": "Small capitals" } as const;
export type TextVariant = keyof typeof TEXT_VARIANTS;

/** Colours that fill the letters (D183): a straight gradient at an angle, in degrees. */
export type TextGradient = { colors: string[]; angle: number };
export const TEXT_GRADIENT_COLORS = { min: 2, max: 4 } as const;
export const TEXT_GRADIENT_ANGLE_DEFAULT = 90;

export type Measure<U extends string> = { value: number; unit: U };
/** A shadow behind the letters: its colour and how far it falls and how soft it is, in pixels. */
export type TextShadow = { color: string; x: number; y: number; blur: number };

/** One kind of text's settings, each optional (the site's, or what the part inherits, where left out). */
export type Typography = {
  /** A Google Fonts family, installed for the store (D59). */
  family?: string;
  weight?: TextWeight;
  size?: Measure<FontSizeUnit>;
  lineHeight?: Measure<LineHeightUnit>;
  align?: TypographyAlign;
  letterSpacing?: Measure<LetterSpacingUnit>;
  transform?: TextTransform;
  decoration?: TextDecoration;
  style?: TextStyle;
  variant?: TextVariant;
  textShadow?: TextShadow;
  /** Its letters filled with a gradient (D183), two to four colours at an angle; over its colour. */
  gradient?: TextGradient;
  /** Its colour (D180, `docs/text-colour.md`), `#rrggbb`; the inherited one unless set. */
  color?: string;
  /** How solid its colour is, 0 to 100 (solid unless set); it acts on a colour set here or inherited from a larger size. */
  opacity?: number;
};
export type TypographyKey = keyof Typography;
export const TYPOGRAPHY_KEYS = [
  "family",
  "weight",
  "size",
  "lineHeight",
  "align",
  "letterSpacing",
  "transform",
  "decoration",
  "style",
  "variant",
  "textShadow",
  "gradient",
  "color",
  "opacity",
] as const satisfies readonly TypographyKey[];

/** At a smaller size: the same, and a shadow can be none there (`null`) though a larger size has one. */
export type TypographyOverride = Omit<Typography, "textShadow" | "gradient"> & { textShadow?: TextShadow | null; gradient?: TextGradient | null };

/** The kinds of text a part can have, each with its own settings. */
export const TEXT_ROLES = [
  "text",
  "heading",
  "title",
  "body",
  "excerpt",
  "price",
  "quote",
  "name",
  "meta",
  "label",
  "value",
  "input",
  "button",
  "badge",
  "message",
  "caption",
  // A dual button's two (D180: each its own colour, as each had its own text colour).
  "first",
  "second",
] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

/** A part's typography: per kind of text (Extra large). */
export type TypographyGroups = Partial<Record<TextRole, Typography>>;
/** A smaller size's typography: per kind of text, what differs. */
export type TypographyGroupsAt = Partial<Record<TextRole, TypographyOverride>>;

/** What a value may be, by unit: nothing that hides text or runs off the page. */
export const SIZE_LIMITS: Record<FontSizeUnit, [number, number]> = { px: [1, 400], em: [0.1, 30], rem: [0.1, 30], "%": [10, 1000], vw: [0.1, 50] };
export const LINE_HEIGHT_LIMITS: Record<LineHeightUnit, [number, number]> = { "": [0.5, 5], px: [1, 400] };
export const LETTER_SPACING_LIMITS: Record<LetterSpacingUnit, [number, number]> = { px: [-20, 100], em: [-1, 2] };
export const SHADOW_OFFSET_MAX = 100;
export const SHADOW_BLUR_MAX = 100;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Four decimals at most, so a value typed or folded in is written the same everywhere. */
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

const measure = <U extends string>(what: string, units: readonly [U, ...U[]], limits: Record<U, [number, number]>) =>
  z
    .object({ value: z.number().finite(`${what} is a number.`), unit: z.enum(units, `${what} has an unknown unit.`) })
    .superRefine((m, ctx) => {
      const [min, max] = limits[m.unit];
      if (m.value < min || m.value > max) ctx.addIssue({ code: "custom", message: `${what} in ${m.unit || "times the text's size"} is ${min} to ${max}.` });
    })
    .transform((m) => ({ value: round4(m.value), unit: m.unit }));

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits, like #1f2937.");
const shadowSchema = z.object({
  color: hex,
  x: z.number().int("A shadow's offset is whole pixels.").min(-SHADOW_OFFSET_MAX).max(SHADOW_OFFSET_MAX),
  y: z.number().int("A shadow's offset is whole pixels.").min(-SHADOW_OFFSET_MAX).max(SHADOW_OFFSET_MAX),
  blur: z.number().int("A shadow's blur is whole pixels.").min(0).max(SHADOW_BLUR_MAX),
});

const gradientSchema = z.object({
  colors: z.array(hex).min(TEXT_GRADIENT_COLORS.min).max(TEXT_GRADIENT_COLORS.max),
  angle: z.number().int().min(0).max(360),
});

const typographyShape = {
  family: fontFamily.optional(),
  weight: z
    .number()
    .int()
    .refine((w) => (TEXT_WEIGHT_VALUES as number[]).includes(w), "A weight is 100 to 900, in hundreds.")
    .transform((w) => w as TextWeight)
    .optional(),
  size: measure("A text's size", FONT_SIZE_UNITS, SIZE_LIMITS).optional(),
  lineHeight: measure("A line height", LINE_HEIGHT_UNITS, LINE_HEIGHT_LIMITS).optional(),
  align: z.enum(Object.keys(TEXT_ALIGNS) as [TypographyAlign, ...TypographyAlign[]]).optional(),
  letterSpacing: measure("Letter spacing", LETTER_SPACING_UNITS, LETTER_SPACING_LIMITS).optional(),
  transform: z.enum(Object.keys(TEXT_TRANSFORMS) as [TextTransform, ...TextTransform[]]).optional(),
  decoration: z.enum(Object.keys(TEXT_DECORATIONS) as [TextDecoration, ...TextDecoration[]]).optional(),
  style: z.enum(Object.keys(TEXT_STYLES) as [TextStyle, ...TextStyle[]]).optional(),
  variant: z.enum(Object.keys(TEXT_VARIANTS) as [TextVariant, ...TextVariant[]]).optional(),
  color: hex.optional(),
  opacity: opacityValue.optional(),
};

/** Settings left out are none; a group with nothing set is left out, and so is a part's typography with no group. */
const compact = <T extends Record<string, unknown>>(value: T | undefined): T | undefined => {
  if (!value) return undefined;
  const kept = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(kept).length > 0 ? kept : undefined;
};
const groups = <T extends z.ZodType>(one: T) =>
  z
    .partialRecord(z.enum(TEXT_ROLES, "Typography for an unknown kind of text."), one)
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const kept = Object.fromEntries(
        Object.entries(value).flatMap(([role, settings]) => {
          const own = compact(settings as Record<string, unknown> | undefined);
          return own ? [[role, own]] : [];
        }),
      );
      return Object.keys(kept).length > 0 ? kept : undefined;
    });

/** A part's typography (Extra large). */
export const typographyGroupsSchema = groups(z.object({ ...typographyShape, textShadow: shadowSchema.optional(), gradient: gradientSchema.optional() }));
/** A smaller size's: the same, and a shadow can be none there. */
export const typographyAtSchema = groups(z.object({ ...typographyShape, textShadow: shadowSchema.nullable().optional(), gradient: gradientSchema.nullable().optional() }));

// ---------------------------------------------------------------------------
// Reading at a size
// ---------------------------------------------------------------------------

type WithTypography = { typography?: TypographyGroups; at?: Partial<Record<SmallerSize, { typography?: TypographyGroupsAt }>> };

/** The sizes looked in for a value at `size`, from the size itself up to Large (Extra large is the part's own). */
const walk = (size: Size): SmallerSize[] => (size === "xl" ? [] : SMALLER_SIZES.slice(0, SMALLER_SIZES.indexOf(size) + 1).reverse());

/** One setting of a kind of text at a size: the size's own, else the next larger size's, up to the part's own. `null`: a shadow taken away there. */
export function typographyValueAt<K extends TypographyKey>(part: WithTypography, role: TextRole, key: K, size: Size): TypographyOverride[K] | undefined {
  for (const s of walk(size)) {
    const value = part.at?.[s]?.typography?.[role]?.[key];
    if (value !== undefined) return value as TypographyOverride[K];
  }
  return part.typography?.[role]?.[key] as TypographyOverride[K] | undefined;
}

/** A kind of text's settings at a size, each walked on its own (an override of the size alone keeps the larger weight). */
export function typographyAt(part: WithTypography, role: TextRole, size: Size): TypographyOverride {
  const out: Record<string, unknown> = {};
  for (const key of TYPOGRAPHY_KEYS) {
    const value = typographyValueAt(part, role, key, size);
    if (value !== undefined) out[key] = value;
  }
  return out as TypographyOverride;
}

/** Every family a part's typography names, at any size. */
export function typographyFamilies(part: WithTypography): string[] {
  const all: (Typography | TypographyOverride | undefined)[] = [
    ...Object.values(part.typography ?? {}),
    ...SMALLER_SIZES.flatMap((s) => Object.values(part.at?.[s]?.typography ?? {})),
  ];
  return [...new Set(all.flatMap((t) => (t?.family ? [t.family] : [])))];
}

// ---------------------------------------------------------------------------
// The kinds of text of each part, and where they are drawn
// ---------------------------------------------------------------------------

/**
 * A kind of text of a part: its name in the builder, and the element its settings are written on (`&` is the part's own
 * element; text inside inherits what is written there). `strong`: written with the part's class rather than inside
 * `:where()`, to win over a site rule of its own (rich text's line height). `align`: where its alignment goes (`box`: the
 * part's own element, as text alignment always was; `self`: the element; `false`: none, the component's own Position
 * places it). `family`: how its family at Extra large is drawn: the family's class on the part (`box`) or on the element
 * (`element`, which the component draws), or a rule (`rule`). A family that differs by size is always a rule. `flatten`: a
 * size set here is the size of everything the component draws (its parts' own sizes give way, `font-size: inherit`), for
 * components whose texts are the site's own pieces (a header's parts, a menu, a product's parts); a colour set there is
 * likewise the colour of all it draws but its buttons. `colourFrom` (D180): where the role has no colour at a size, the
 * colour of that role (a dual button's first and second take the buttons' text colour); `colour: false`: the role's colour
 * is drawn only through the roles that take it (`colourFrom`), as its selector names the same elements.
 */
export type RoleDef = {
  role: TextRole;
  label: string;
  selector: string;
  strong?: boolean;
  align: "box" | "self" | false;
  family: "box" | "element" | "rule";
  flatten?: boolean;
  colourFrom?: TextRole;
  colour?: false;
};

const TEXT: RoleDef = { role: "text", label: "Text", selector: "&", align: "self", family: "box" };
const role = (role: TextRole, label: string, selector: string, extra: Partial<RoleDef> = {}): RoleDef => ({
  role,
  label,
  selector,
  align: "self",
  family: "rule",
  ...extra,
});
/** Elements a component marks with `data-kz-text` (where a selector cannot name them otherwise). */
const marked = (name: TextRole) => `& [data-kz-text=${name}]`;

/** The product parts whose alignment is their text's (the rest are placed as they are). */
export const ALIGNED_PRODUCT_PARTS: readonly string[] = ["back", "title", "price", "host", "description", "withdrawal", "safety"];

/** What a block is, as far as its kinds of text go. */
type TypedPart = { type?: string; part?: string };

const FORM_ROLES: RoleDef[] = [
  TEXT,
  role("label", "Labels", "& label"),
  role("input", "Fields and hints", "& :is(input, textarea, select)"),
  role("button", "Button", "& button[type=submit]"),
  role("message", "Thank-you message", "& [role=status]"),
];

/**
 * The kinds of text of a row, column or block, in the order the builder shows them; none for a part without text (a
 * separator, a video, HTML in its own frame). Every text a component draws is one of them (`TEXT_FIELDS` says which, and
 * `typography.test.ts` fails for a text of a block that has none): a new text is a field there and, where it needs an
 * element of its own, a role here with its component marking it (`data-kz-text`).
 */
export function textRoles(part: TypedPart): RoleDef[] {
  switch (part.type) {
    case undefined:
    case "row":
      return [TEXT];
    case "richText":
      return [{ ...TEXT, selector: "& .rich-text", strong: true, align: "box" }];
    case "heading":
      return [{ ...TEXT, selector: "& :is(h1, h2, h3, h4, h5, h6)", align: "box" }];
    case "button":
      // Its alignment is the button's Position.
      return [{ ...TEXT, label: "Button text", selector: "& [data-button-frame]", align: false }];
    case "dualButton":
      // Both buttons' text, then each button's own (its colour, as each had its own text colour before D180).
      return [
        { ...TEXT, label: "Buttons' text", selector: "& [data-dual-buttons] > a", align: false, colour: false },
        role("first", "First button", marked("first"), { align: false, colourFrom: "text" }),
        role("second", "Second button", marked("second"), { align: false, colourFrom: "text" }),
      ];
    case "image":
      // A picture's alignment is its Position; its caption's text is its own.
      return [role("caption", "Caption", "& figcaption", { family: "box" })];
    case "contentGrid":
      return [
        TEXT,
        role("title", "Titles", marked("title"), { family: "element" }),
        role("excerpt", "Texts", marked("excerpt")),
        role("price", "Prices", marked("price")),
        role("meta", "Details and fields", marked("meta")),
        role("badge", "Badges", marked("badge")),
        role("button", "Buttons", marked("button"), { align: false }),
      ];
    case "accordion":
    case "faq":
      return [
        TEXT,
        role("title", part.type === "faq" ? "Questions" : "Titles", "& summary"),
        role("body", part.type === "faq" ? "Answers" : "Texts", "& details .rich-text", { strong: true }),
      ];
    case "tabs":
      return [TEXT, role("title", "Tab titles", "& [role=tab]"), role("body", "Texts", "& [role=tabpanel] .rich-text", { strong: true })];
    case "testimonials":
      return [TEXT, role("quote", "Quotes", "& blockquote"), role("name", "Names", marked("name")), role("meta", "Titles and places", marked("meta"))];
    case "socialLinks":
      return [TEXT, role("name", "Network names", marked("name"))];
    case "emailForm":
    case "newsletter":
      return FORM_ROLES;
    case "plans":
      return [
        TEXT,
        role("name", "Plan names", marked("name")),
        role("price", "Prices", marked("price")),
        role("meta", "What each includes", marked("meta")),
        role("button", "Buttons", marked("button"), { align: false }),
      ];
    case "menu":
    case "site":
      // Their alignment is their Position; their pieces (links, details, icons' words) take the size set.
      return [{ ...TEXT, align: false, flatten: true }];
    case "search":
      return [{ ...TEXT, flatten: true }, role("input", "Search box", "& input")];
    case "customField":
      return [
        { ...TEXT, label: "Values", selector: "&, & [data-kz-text=value]" },
        role("heading", "Heading", "& :is(h2, h3)"),
        role("label", "Labels", "& :is(dt, th, [data-kz-text=label])"),
      ];
    case "fieldLoop":
      return [
        TEXT,
        role("heading", "Heading", "& h2"),
        role("title", "Titles", marked("title")),
        role("excerpt", "Texts", marked("excerpt")),
        role("badge", "Badges", marked("badge")),
        role("button", "Links", marked("button")),
      ];
    case "product":
      // The title's own element (the builder's stand-in is not a heading).
      if (part.part === "title") return [{ ...TEXT, selector: "& :is(h1, [data-kz-stand-in=title])", align: "box" }];
      return [{ ...TEXT, align: ALIGNED_PRODUCT_PARTS.includes(part.part ?? "") ? "box" : false, flatten: true }, role("heading", "Heading", "& h2")];
    case "separator":
    case "video":
    case "html":
      return [];
    default:
      // A column (no type), a shop component, and every other component: its text inherits what is set on it.
      return [TEXT];
  }
}

/**
 * Which kind of text each text of a block is in (D179 phase 3): the texts `mapBlockTexts()` lists, by their key with item
 * ids as `*` (`items.*.title`), and the texts a component draws that are not the page's own words (a person's name, a
 * plan's, a network's, a store's details and menus, a product's words, custom fields' labels and values). Every one has a
 * kind of text with a size of its own; `typography.test.ts` holds that, so a new text needs an entry here.
 */
export const TEXT_FIELDS: Record<string, Record<string, TextRole>> = {
  richText: { doc: "text" },
  heading: { text: "text" },
  button: { label: "text" },
  dualButton: { "first.label": "text", "second.label": "text" },
  image: { caption: "caption" },
  contentGrid: {
    buttonLabel: "button",
    emptyText: "text",
    "*.title": "title",
    "*.text": "excerpt",
    "*.badge": "badge",
    "*.priceText": "price",
    "*.buttonLabel": "button",
    "*.detail-*.label": "meta",
    "*.detail-*.text": "meta",
    "product price": "price",
    "date and fields": "meta",
  },
  accordion: { "*.title": "title", "*.body": "body" },
  tabs: { "*.title": "title", "*.body": "body" },
  faq: { "*.title": "title", "*.body": "body" },
  testimonials: { "*.quote": "quote", "*.role": "meta", "*.name": "name" },
  iconList: { "*.text": "text" },
  table: { caption: "text", "r*": "text" },
  socialLinks: { "network names": "name" },
  emailForm: {
    "*.label": "label",
    "*.placeholder": "input",
    "*.option*": "input",
    submitLabel: "button",
    successMessage: "message",
    consent: "label",
  },
  newsletter: { placeholder: "input", submitLabel: "button", successMessage: "message", consent: "label" },
  plans: { buttonLabel: "button", "plan names": "name", "prices": "price", "what each includes": "meta", "fees and descriptions": "text" },
  product: { heading: "heading", "the product's words": "text" },
  customField: { heading: "heading", "field labels": "label", "field values": "text" },
  fieldLoop: { heading: "heading", "slot title": "title", "slot text": "excerpt", "slot badge": "badge", "slot link": "button" },
  menu: { "menu links": "text" },
  search: { "search box": "input", results: "text" },
  site: { "the site's words": "text" },
  storePart: { "the shop's words": "text" },
};

/**
 * Texts that are not drawn as words on the page, and so take no size: a picture's description (alt text), a video's and an
 * HTML frame's title (their accessible names), and a form's email subject (in the email only).
 */
export const UNDRAWN_TEXTS: Record<string, readonly string[]> = {
  image: ["alt"],
  contentGrid: ["*.alt"],
  video: ["title"],
  html: ["title"],
  emailForm: ["subject"],
};

/** The family drawn as a class at Extra large for a role whose family is `box` or `element`, or none. */
export function familyClassOf(part: WithTypography, def: RoleDef): string | undefined {
  if (def.family === "rule") return undefined;
  if (familyVaries(part, def.role)) return undefined;
  return part.typography?.[def.role]?.family;
}

/** Whether a role's family differs by size (then it is drawn as a rule at every size, not a class). */
export function familyVaries(part: WithTypography, role: TextRole): boolean {
  const base = part.typography?.[role]?.family;
  return SIZES.some((size) => typographyValueAt(part, role, "family", size) !== base);
}

/** The family classes a part's element takes: its roles drawn on the part itself. */
export function boxFamilies(part: WithTypography & TypedPart): string[] {
  const roles = part.type === undefined || part.type === "row" ? [TEXT] : textRoles(part);
  return roles.filter((def) => def.family === "box").flatMap((def) => familyClassOf(part, def) ?? []);
}

// ---------------------------------------------------------------------------
// As CSS
// ---------------------------------------------------------------------------

type Decl = Record<string, string>;

const FALLBACK = "ui-sans-serif, system-ui, sans-serif";
/** A family as a rule writes it: the family, then the system's while it loads (the class from its stylesheet knows its kind; a rule does not). */
export const familyStack = (family: string) => `"${family}", ${FALLBACK}`;

const num = (n: number) => String(round4(n));

/** What a kind of text's settings say as declarations, without its family and alignment (written apart). */
export function typographyDecl(t: TypographyOverride): Decl {
  const out: Decl = {};
  if (t.weight !== undefined) out["font-weight"] = String(t.weight);
  if (t.size) out["font-size"] = `${num(t.size.value)}${t.size.unit}`;
  if (t.lineHeight) out["line-height"] = `${num(t.lineHeight.value)}${t.lineHeight.unit}`;
  if (t.letterSpacing) out["letter-spacing"] = `${num(t.letterSpacing.value)}${t.letterSpacing.unit}`;
  if (t.transform) out["text-transform"] = t.transform;
  if (t.decoration) out["text-decoration-line"] = t.decoration;
  if (t.style) out["font-style"] = t.style;
  if (t.variant) out["font-variant-caps"] = t.variant;
  if (t.gradient === null) {
    // Taken away at a size where a larger one has it: the letters take their colour again.
    out["background-image"] = "none";
    out["-webkit-text-fill-color"] = "currentcolor";
  } else if (t.gradient) {
    out["background-image"] = `linear-gradient(${t.gradient.angle}deg, ${t.gradient.colors.join(", ")})`;
    out["-webkit-background-clip"] = "text";
    out["background-clip"] = "text";
    out["-webkit-text-fill-color"] = "transparent";
  }
  if (t.textShadow === null) out["text-shadow"] = "none";
  else if (t.textShadow) out["text-shadow"] = `${t.textShadow.x}px ${t.textShadow.y}px ${t.textShadow.blur}px ${t.textShadow.color}`;
  return out;
}

/**
 * A kind of text's colour at a size (D180): its own colour (else, with `colourFrom`, the other role's) with the opacity of
 * the same role at that size; undefined where neither has a colour. An opacity alone (no colour anywhere) draws nothing.
 */
export function colourAt(part: WithTypography, def: Pick<RoleDef, "role" | "colourFrom">, size: Size): { color: string; opacity?: number } | undefined {
  for (const role of def.colourFrom ? [def.role, def.colourFrom] : [def.role]) {
    const color = typographyValueAt(part, role, "color", size) as string | undefined;
    if (color) {
      const opacity = typographyValueAt(part, role, "opacity", size) as number | undefined;
      return opacity === undefined ? { color } : { color, opacity };
    }
  }
  return undefined;
}

/** A kind of text's colour at a size as CSS, or undefined (`colourCss()`). */
export function colourCssAt(part: WithTypography, def: Pick<RoleDef, "role" | "colourFrom">, size: Size): string | undefined {
  const own = colourAt(part, def, size);
  return own ? colourCss(own.color, own.opacity) : undefined;
}

// ---------------------------------------------------------------------------
// Headings' sizes (formerly Tailwind classes with `md:` breakpoints)
// ---------------------------------------------------------------------------

/** How large a heading looks, apart from its level (D49): the names the builder offered before the Typography panel. */
export type HeadingPreset = "sm" | "md" | "lg" | "xl" | "2xl";

/**
 * Each preset's text size and line height from Medium up and on Small, in rem and pixels: what Tailwind's `text-lg`,
 * `text-xl md:text-2xl`, `text-2xl md:text-3xl`, `text-3xl md:text-5xl` and `text-4xl md:text-6xl` were (`md:` is the
 * store's Medium now, D179). Line heights are each size's own (Tailwind's), for text that has no line height of its own.
 */
export const HEADING_PRESETS: Record<HeadingPreset, { from: [number, number]; small: [number, number] }> = {
  sm: { from: [1.125, 28], small: [1.125, 28] },
  md: { from: [1.5, 32], small: [1.25, 28] },
  lg: { from: [1.875, 36], small: [1.5, 32] },
  xl: { from: [3, 48], small: [1.875, 36] },
  "2xl": { from: [3.75, 60], small: [2.25, 40] },
};

/** The preset a heading of each level has unless its size is set (D49). */
export const HEADING_LEVEL_PRESET: Record<1 | 2 | 3 | 4 | 5 | 6, HeadingPreset> = { 1: "xl", 2: "lg", 3: "md", 4: "sm", 5: "sm", 6: "sm" };

/** A heading's text size at each screen size where nothing sets one: its level's preset, by the store's screen sizes. */
export function headingDefaultSize(level: number, size: Size): string {
  const preset = HEADING_PRESETS[HEADING_LEVEL_PRESET[level as 1] ?? "sm"];
  return `${(size === "sm" ? preset.small : preset.from)[0]}rem`;
}

// ---------------------------------------------------------------------------
// The upgrade of settings saved before the panel
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const OLD_WEIGHTS: Record<string, TextWeight> = { normal: 400, medium: 500, semibold: 600, bold: 700 };
const OLD_PRESETS = new Set(Object.keys(HEADING_PRESETS));
const ALIGNS = new Set(Object.keys(TEXT_ALIGNS));

/** A preset as typography: its size from Medium up, and on Small where it differs; with `lineHeight`, each size's line height too. */
export function presetTypography(preset: HeadingPreset, lineHeight: boolean): { base: Typography; small?: Typography } {
  const { from, small } = HEADING_PRESETS[preset];
  const at = (value: [number, number]): Typography => ({
    size: { value: value[0], unit: "rem" },
    ...(lineHeight && { lineHeight: { value: value[1], unit: "px" as const } }),
  });
  return { base: at(from), ...(small[0] !== from[0] || small[1] !== from[1] ? { small: at(small) } : {}) };
}

/** Writes settings into a stored part's typography (Extra large, or a smaller size), as raw JSON. */
function put(raw: Json, role: TextRole, settings: Json, size?: SmallerSize) {
  if (size) {
    const at = isObject(raw.at) ? { ...raw.at } : {};
    const own = isObject(at[size]) ? { ...(at[size] as Json) } : {};
    const typography = isObject(own.typography) ? { ...(own.typography as Json) } : {};
    typography[role] = { ...(isObject(typography[role]) ? (typography[role] as Json) : {}), ...settings };
    own.typography = typography;
    at[size] = own;
    raw.at = at;
    return;
  }
  const typography = isObject(raw.typography) ? { ...raw.typography } : {};
  typography[role] = { ...(isObject(typography[role]) ? (typography[role] as Json) : {}), ...settings };
  raw.typography = typography;
}

/** Moves a stored part's alignment (and its overrides) into a role's typography. */
function moveAlign(raw: Json, role: TextRole) {
  if ("align" in raw && raw.align !== undefined) {
    // A value the old shape could not hold goes with it, for the schema to refuse as it did.
    put(raw, role, { align: raw.align });
    delete raw.align;
  }
  if (!isObject(raw.at)) return;
  for (const size of SMALLER_SIZES) {
    const at: Json = { ...(raw.at as Json) };
    const own = isObject(at[size]) ? { ...(at[size] as Json) } : undefined;
    if (!own || typeof own.align !== "string" || !ALIGNS.has(own.align)) continue;
    const align = own.align;
    delete own.align;
    at[size] = own;
    raw.at = at;
    put(raw, role, { align }, size);
  }
  const kept = Object.fromEntries(Object.entries(raw.at as Json).filter(([, v]) => !isObject(v) || Object.keys(v).length > 0));
  if (Object.keys(kept).length > 0) raw.at = kept;
  else delete raw.at;
}

/** Folds a preset size into a role's typography. */
function movePreset(raw: Json, key: string, role: TextRole, lineHeight: boolean) {
  const preset = raw[key];
  if (key in raw) delete raw[key];
  if (preset === undefined) return;
  // Not a size the old shape had: kept as it is, for the schema to refuse.
  if (typeof preset !== "string" || !OLD_PRESETS.has(preset)) return put(raw, role, { size: preset });
  const { base, small } = presetTypography(preset as HeadingPreset, lineHeight);
  put(raw, role, base);
  if (small) put(raw, role, small, "sm");
}

function moveWeight(raw: Json, role: TextRole) {
  const weight = raw.weight;
  if (!("weight" in raw)) return;
  delete raw.weight;
  if (weight === undefined) return;
  put(raw, role, { weight: typeof weight === "string" && weight in OLD_WEIGHTS ? OLD_WEIGHTS[weight] : weight });
}

function moveFont(raw: Json, key: string, role: TextRole) {
  const font = raw[key];
  if (!(key in raw)) return;
  delete raw[key];
  // Empty is none, as it was; anything else that is not a family is the schema's to refuse.
  if (font === undefined || font === null || (typeof font === "string" && font.trim() === "")) return;
  put(raw, role, { family: typeof font === "string" ? font.trim() : font });
}

/** Moves a text colour kept on its own (before D180) into a role's colour. */
function moveColour(raw: Json, key: string, role: TextRole) {
  const color = raw[key];
  if (!(key in raw)) return;
  delete raw[key];
  if (color === undefined) return;
  // A value the old shape could not hold goes with it, for the schema to refuse as it did.
  put(raw, role, { color });
}

/** Moves a nested look's text colour (a dual button's side, a grid's or a form's button) into a role's colour. */
function moveNestedColour(raw: Json, key: string, role: TextRole) {
  const own = raw[key];
  if (!isObject(own) || !("textColor" in own)) return;
  const next = { ...own };
  const color = next.textColor;
  delete next.textColor;
  raw[key] = next;
  if (color !== undefined) put(raw, role, { color });
}

/** Blocks whose buttons kept a text colour of their own before D180. */
const BUTTON_LOOKS = new Set(["contentGrid", "emailForm", "newsletter"]);

/** Whether a stored block holds settings from before the Typography panel (D179) or a text colour of its own (D180). */
const OLD_KEYS = ["font", "headingFont", "headingSize", "titleSize"] as const;
function holdsOld(raw: Json): boolean {
  if (OLD_KEYS.some((key) => key in raw)) return true;
  if ((raw.type === "heading" || raw.type === "button") && "textColor" in raw) return true;
  if (raw.type === "dualButton" && [raw.first, raw.second].some((side) => isObject(side) && "textColor" in side)) return true;
  if (BUTTON_LOOKS.has(String(raw.type)) && isObject(raw.button) && "textColor" in raw.button) return true;
  if ((raw.type === "heading" || raw.type === "button" || raw.type === "dualButton") && "weight" in raw) return true;
  if (raw.type === "heading" && "size" in raw) return true;
  if (raw.type === "product" && raw.part === "title" && "size" in raw) return true;
  if (raw.type === "richText" || raw.type === "heading" || (raw.type === "product" && ALIGNED_PRODUCT_PARTS.includes(String(raw.part)))) {
    if ("align" in raw) return true;
    if (isObject(raw.at) && SMALLER_SIZES.some((s) => isObject((raw.at as Json)[s]) && "align" in ((raw.at as Json)[s] as Json))) return true;
  }
  return false;
}

/**
 * A block as stored before the Typography panel, with its text settings in `typography` (and `at.*.typography`): drawn the
 * same. A block already in the new shape is returned as it is. A value the old shape could not hold is dropped with its
 * key, as the schema would have refused it.
 */
export function foldTypography(value: unknown): unknown {
  if (!isObject(value) || !holdsOld(value)) return value;
  const raw: Json = { ...value };
  switch (raw.type) {
    case "heading":
      movePreset(raw, "size", "text", false);
      moveWeight(raw, "text");
      moveAlign(raw, "text");
      moveFont(raw, "font", "text");
      moveColour(raw, "textColor", "text");
      break;
    case "richText":
      moveAlign(raw, "text");
      moveFont(raw, "font", "text");
      break;
    case "image":
      moveFont(raw, "font", "caption");
      break;
    case "button":
    case "dualButton":
      moveWeight(raw, "text");
      moveFont(raw, "font", "text");
      moveColour(raw, "textColor", "text");
      moveNestedColour(raw, "first", "first");
      moveNestedColour(raw, "second", "second");
      break;
    case "accordion":
    case "faq":
      movePreset(raw, "titleSize", "title", true);
      moveFont(raw, "font", "text");
      break;
    case "contentGrid":
      movePreset(raw, "headingSize", "title", false);
      moveFont(raw, "font", "text");
      moveFont(raw, "headingFont", "title");
      moveNestedColour(raw, "button", "button");
      break;
    case "emailForm":
    case "newsletter":
      moveFont(raw, "font", "text");
      moveNestedColour(raw, "button", "button");
      break;
    case "product":
      if (raw.part === "title") movePreset(raw, "size", "text", true);
      else if ("size" in raw) delete raw.size;
      if (ALIGNED_PRODUCT_PARTS.includes(String(raw.part))) moveAlign(raw, "text");
      moveFont(raw, "font", "text");
      break;
    default:
      moveFont(raw, "font", "text");
  }
  return raw;
}

/** What a heading block's old look (D49) is as typography, for the writers that still think in its names (the AI page studio). */
export function headingLook(look: { size?: HeadingPreset; weight?: keyof typeof OLD_WEIGHTS; align?: TypographyAlign }): Pick<WithTypography, "typography" | "at"> {
  const folded = foldTypography({ type: "heading", ...look }) as Json;
  return { ...(folded.typography ? { typography: folded.typography as TypographyGroups } : {}), ...(folded.at ? { at: folded.at as WithTypography["at"] } : {}) };
}

/** Text alignment as a part's typography. */
export const alignTypography = (align: TypographyAlign | undefined): { typography?: TypographyGroups } => (align ? { typography: { text: { align } } } : {});

// ---------------------------------------------------------------------------
// Editing at a size (the builder's Typography panel)
// ---------------------------------------------------------------------------

type At = Partial<Record<SmallerSize, Record<string, unknown> & { typography?: TypographyGroupsAt }>>;
type Editable = { typography?: TypographyGroups; at?: At };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A setting's value at `size` without the size's own: what it inherits from the larger sizes, or the part's own. */
export function typographyInherited<K extends TypographyKey>(part: Editable, role: TextRole, key: K, size: Size): TypographyOverride[K] | undefined {
  if (size === "xl") return undefined;
  for (const s of walk(size).slice(1)) {
    const value = part.at?.[s]?.typography?.[role]?.[key];
    if (value !== undefined) return value as TypographyOverride[K];
  }
  return part.typography?.[role]?.[key] as TypographyOverride[K] | undefined;
}

/** Where a setting's value at `size` comes from: set at the size (`own`), or at `from` (null: nowhere). */
export function typographySource(part: Editable, role: TextRole, key: TypographyKey, size: Size): { own: boolean; from: Size | null } {
  const base = part.typography?.[role]?.[key];
  if (size === "xl") return { own: base !== undefined, from: base !== undefined ? "xl" : null };
  if (part.at?.[size]?.typography?.[role]?.[key] !== undefined) return { own: true, from: size };
  for (const s of walk(size).slice(1)) if (part.at?.[s]?.typography?.[role]?.[key] !== undefined) return { own: false, from: s };
  return { own: false, from: base !== undefined ? "xl" : null };
}

function withGroup<G extends Record<string, unknown>>(groupsIn: Partial<Record<TextRole, G>> | undefined, role: TextRole, key: string, value: unknown) {
  const own: Record<string, unknown> = { ...(groupsIn?.[role] ?? {}) };
  if (value === undefined) delete own[key];
  else own[key] = value;
  const next: Record<string, unknown> = { ...(groupsIn ?? {}) };
  if (Object.keys(own).length > 0) next[role] = own;
  else delete next[role];
  return Object.keys(next).length > 0 ? (next as Partial<Record<TextRole, G>>) : undefined;
}

function withSizeGroup(at: At | undefined, size: SmallerSize, role: TextRole, key: string, value: unknown): At | undefined {
  const next: At = {};
  for (const s of SMALLER_SIZES) {
    const own: Record<string, unknown> = { ...(at?.[s] ?? {}) };
    if (s === size) {
      const typography = withGroup(own.typography as TypographyGroupsAt | undefined, role, key, value);
      if (typography) own.typography = typography;
      else delete own.typography;
    }
    if (Object.keys(own).length > 0) next[s] = own as At[SmallerSize];
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * What a change in the Typography panel at `size` does to a part: at Extra large the part's own value (undefined takes it
 * away); below it the size's override, only where it differs from what the size inherits (a value equal to it takes the
 * override away), and a shadow taken away over an inherited one is `null`.
 */
export function typographyPatch<K extends TypographyKey>(part: Editable, size: Size, role: TextRole, key: K, value: Typography[K] | undefined): { typography?: TypographyGroups; at?: At } {
  if (size === "xl") return { typography: withGroup(part.typography, role, key, value) };
  const inherited = typographyInherited(part, role, key, size);
  let next: unknown = value;
  if (same(value, inherited)) next = undefined;
  else if (value === undefined) next = (key === "textShadow" || key === "gradient") && inherited ? null : undefined;
  return { at: withSizeGroup(part.at, size, role, key, next) };
}

/** Takes a setting's override at `size` away, so the size inherits again. */
export function clearTypographyAt(part: Editable, size: Size, role: TextRole, key: TypographyKey): { at?: At } {
  if (size === "xl") return { at: part.at };
  return { at: withSizeGroup(part.at, size, role, key, undefined) };
}
