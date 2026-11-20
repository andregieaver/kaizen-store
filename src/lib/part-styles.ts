import { z } from "zod";

import { type SmallerSize } from "./breakpoints";
import { CONTENT_MAX_MAX, CONTENT_MAX_MIN } from "./content-width";
import { typographyAtSchema, typographyGroupsSchema, type TypographyGroups, type TypographyGroupsAt } from "./typography";

/**
 * The style settings every part of a page can have (D47 to D49, D179): spacing, a border, rounded corners, a shadow, a colour
 * behind it and what changes per screen size, with their limits and schemas, and the theme's element built from them
 * (`themeElementSchema`, D182). A leaf of the page model: it imports no block schema and never `page-content.ts`, which
 * re-exports every name here, so that reading a store's theme (`src/lib/theme-elements.ts`, `src/server/stores.ts`) does not
 * build the whole page model (bloat review step 2.22; code review step 3.2 keeps it as the page model's leaf).
 */

/** Space on each side, in pixels (D47). */
export type Sides = { top: number; right: number; bottom: number; left: number };

/** A row's, column's or block's margin (outside) and padding (inside); none when left out. */
export type Spacing = { margin?: Sides; padding?: Sides };

export const SPACING_MAX = 240;

/** A row's height as a share of the screen's, in per cent (D184). */
export const ROW_HEIGHT_VH = { min: 5, max: 300 } as const;

/** A column's share is a whole number up to this; dragging the edges between columns makes shares of 100 (a percent each). */
export const COLUMN_SHARE_MAX = 100;

/** A colour as `#rrggbb`. */
export type Color = string;

export const BORDER_STYLES = { solid: "Solid", dashed: "Dashed", dotted: "Dotted" } as const;

export type BorderStyle = keyof typeof BORDER_STYLES;

/** A border (D49): its width on each side, in pixels, its colour and its line. */
export type Border = { width: Sides; color: Color; style: BorderStyle };

export const BORDER_MAX = 20;

export const RADIUS_MAX = 200;

/** Shadows to choose from (D49), each with its CSS. */
export const SHADOWS = {
  sm: { label: "Small", css: "0 1px 3px rgb(0 0 0 / 0.12), 0 1px 2px rgb(0 0 0 / 0.08)" },
  md: { label: "Medium", css: "0 4px 12px rgb(0 0 0 / 0.12)" },
  lg: { label: "Large", css: "0 10px 30px rgb(0 0 0 / 0.15)" },
  xl: { label: "Extra large", css: "0 20px 50px rgb(0 0 0 / 0.2)" },
} as const;

export type Shadow = keyof typeof SHADOWS;

/** The one kind of background a part can take per screen size (D179): a colour; a picture, video or gradient is the part's own. */
export type ColorBackground = { type: "color"; color: Color; opacity?: number };

/**
 * What a part can set per screen size (D179, `docs/responsive-editing.md` 3): its spacing, frame and colour; a row's
 * stacking, order and gap; a column's share of the row and its place; a block's alignment, a picture's width, a grid's
 * columns, gap and carousel, a dual button's stacking. Each kind of part reads the keys that concern it.
 */
export type PartSizeSettings = {
  style?: Spacing;
  /** `null` at a size: none there, though a larger size has one (D179 phase 2); the same for a shadow, colour, blur and width. */
  border?: Border | null;
  radius?: number;
  shadow?: Shadow | null;
  shadowOpacity?: number;
  background?: ColorBackground | null;
  backdropBlur?: number | null;
  /** A row's columns (or a dual button's two) one under another. */
  stack?: boolean;
  /** A row's stacked columns, last first. */
  reverse?: boolean;
  /** Pixels between a row's columns, or a grid's tiles. */
  gap?: number;
  /** A column's share of its row (as a layout's widths: 0 is as wide as what it holds); the row's layout unless set. */
  width?: number;
  /** A column's place in its row. */
  order?: number;
  align?: TextAlign;
  maxWidth?: number | null;
  /** A row's content width in pixels, over the theme's (null: the theme's, though a larger size sets one). */
  contentMax?: number | null;
  /** A row's height as a share of the screen's, in per cent (D184); at least that tall. null: as tall as its content. */
  height?: number | null;
  /** A grid's columns. */
  columns?: number;
  /** A grid shown as a grid or as a carousel. */
  display?: "grid" | "carousel";
  /** The language switcher's languages side by side, one under another or in a drop-down list (D479). */
  switcher?: SwitcherLayout;
  /** The language switcher's words for each language: its name, its short code, or none beside its flag (D479). */
  langText?: SwitcherText;
  /** The language switcher shows each language's flag (D479). */
  langFlag?: boolean;
  /** Its typography at the size, per kind of text: what differs (D179 phase 3). */
  typography?: TypographyGroupsAt;
};

/** How the language switcher lays its languages out (D479): side by side (the default), one under another, or a drop-down list. */
export type SwitcherLayout = "row" | "column" | "dropdown";

/** The words the language switcher gives each language (D479): its name in itself (the default), its short code (`EN`), or none. */
export type SwitcherText = "name" | "code" | "none";

/** Per smaller size, what differs from the size above (D179). */
export type SizeOverrides = Partial<Record<SmallerSize, PartSizeSettings>>;

/** How much what is behind a part may be blurred (D86): kept low, as a large backdrop blur is costly for the browser to draw. */
export const BACKDROP_BLUR_MAX = 20;

export type TextAlign = "left" | "center" | "right";

/** A picture is drawn at its own size and never larger (D151); `maxWidth` makes it narrower, in pixels. */
export const IMAGE_WIDTH_MIN = 16;

/** The bound `image.width` already has. */
export const IMAGE_WIDTH_MAX = 10_000;

export const GRID_GAP_MAX = 96;

export const GRID_COLUMNS_MAX = { mobile: 2, tablet: 4, desktop: 8 } as const;

export const side = z
  .number()
  .int("Spacing is whole pixels.")
  .min(0, "Spacing cannot be below 0.")
  .max(SPACING_MAX, `Keep spacing at ${SPACING_MAX} pixels or less.`);

const sides = z.object({ top: side, right: side, bottom: side, left: side });

// A margin may be negative, to pull a part over its neighbour (D197).
const marginSide = z
  .number()
  .int("Spacing is whole pixels.")
  .min(-SPACING_MAX, `Keep a margin at -${SPACING_MAX} pixels or more.`)
  .max(SPACING_MAX, `Keep spacing at ${SPACING_MAX} pixels or less.`);

const marginSides = z.object({ top: marginSide, right: marginSide, bottom: marginSide, left: marginSide });

export const spacing = z.object({ margin: marginSides.optional(), padding: sides.optional() }).optional();

export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits, like #1f2937.");

const borderWidth = z
  .number()
  .int("A border is whole pixels.")
  .min(0, "A border cannot be below 0.")
  .max(BORDER_MAX, `Keep a border at ${BORDER_MAX} pixels or less.`);

export const borderSchema = z
  .object({
    width: z.object({ top: borderWidth, right: borderWidth, bottom: borderWidth, left: borderWidth }),
    color,
    style: z.enum(Object.keys(BORDER_STYLES) as [BorderStyle, ...BorderStyle[]]),
  })
  .optional();

export const radiusSchema = z
  .number()
  .int("Rounded corners are whole pixels.")
  .min(0)
  .max(RADIUS_MAX, `Keep rounded corners at ${RADIUS_MAX} pixels or less.`)
  .optional();

export const shadowSchema = z.enum(Object.keys(SHADOWS) as [Shadow, ...Shadow[]]).optional();

export const shadowOpacitySchema = z.number().int("A shadow's opacity is whole per cents.").min(0).max(100, "A shadow's opacity is 0 to 100%.").optional();

export const colorBackground = z.object({ type: z.literal("color"), color, opacity: z.number().int().min(0).max(99).optional() });

/** How much what is behind a part is blurred (D86), with no background or a colour. */
export const backdropBlur = z.number().int().min(1).max(BACKDROP_BLUR_MAX).optional();

export const textAlign = z.enum(["left", "center", "right"]).optional();

export const pictureWidth = z
  .number()
  .int("A picture's width is whole pixels.")
  .min(IMAGE_WIDTH_MIN, `Make a picture at least ${IMAGE_WIDTH_MIN} pixels wide.`)
  .max(IMAGE_WIDTH_MAX, `Keep a picture at most ${IMAGE_WIDTH_MAX} pixels wide.`)
  .optional();

export const gridColumnCount = z.number().int().min(1, "A grid has at least one column.").max(GRID_COLUMNS_MAX.desktop, `A grid has at most ${GRID_COLUMNS_MAX.desktop} columns.`);

/** Pixels between a row's columns or a grid's tiles. */
export const partGap = z.number().int().min(0).max(GRID_GAP_MAX, `Keep the space at ${GRID_GAP_MAX} pixels or less.`).optional();

/** A column's share of its row and its place among the others (D179); dragging its edge in the canvas gives shares of 100. */
export const columnShare = z.number().int().min(0).max(COLUMN_SHARE_MAX, `A column's share is 0 to ${COLUMN_SHARE_MAX}.`).optional();

/** A row's height in per cent of the screen's (`PageRow.height`). */
export const rowHeightVh = z.number().int("A height is whole per cents.").min(ROW_HEIGHT_VH.min, `Make a row at least ${ROW_HEIGHT_VH.min}% of the screen high.`).max(ROW_HEIGHT_VH.max, `Keep a row at most ${ROW_HEIGHT_VH.max}% of the screen high.`);

/** How wide a row's content may be (`PageRow.contentMax`), in pixels. */
export const contentMaxWidth = z
  .number()
  .int("A width is whole pixels.")
  .min(CONTENT_MAX_MIN, `Make the content at least ${CONTENT_MAX_MIN} pixels wide.`)
  .max(CONTENT_MAX_MAX, `Keep the content at most ${CONTENT_MAX_MAX} pixels wide.`);

export const columnOrder = z.number().int().min(-12).max(12, "A column's place is -12 to 12.").optional();

/** What a part may set at a smaller size (D179): the same rules as its own settings, each optional. */
const sizeSettings = z.object({
  style: spacing,
  // `null`: none at this size, though a larger size has one (D179 phase 2).
  border: borderSchema.or(z.null()),
  radius: radiusSchema,
  shadow: shadowSchema.or(z.null()),
  shadowOpacity: shadowOpacitySchema,
  background: colorBackground.nullable().optional(),
  backdropBlur: backdropBlur.or(z.null()),
  stack: z.boolean().optional(),
  reverse: z.boolean().optional(),
  gap: partGap,
  width: columnShare,
  order: columnOrder,
  align: textAlign,
  maxWidth: pictureWidth.or(z.null()),
  contentMax: contentMaxWidth.or(z.null()).optional(),
  height: rowHeightVh.or(z.null()).optional(),
  columns: gridColumnCount.optional(),
  display: z.enum(["grid", "carousel"]).optional(),
  switcher: z.enum(["row", "column", "dropdown"]).optional(),
  langText: z.enum(["name", "code", "none"]).optional(),
  langFlag: z.boolean().optional(),
  typography: typographyAtSchema,
});

/** A part's overrides by size, with sizes that set nothing left out. */
export const sizeOverrides = z
  .object({ lg: sizeSettings.optional(), md: sizeSettings.optional(), sm: sizeSettings.optional() })
  .optional()
  .transform((at) => {
    if (!at) return undefined;
    const kept = Object.fromEntries(
      Object.entries(at).flatMap(([size, settings]) => {
        const own = settings ? Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined)) : {};
        return Object.keys(own).length > 0 ? [[size, own]] : [];
      }),
    ) as SizeOverrides;
    return Object.keys(kept).length > 0 ? kept : undefined;
  });

/**
 * What the theme says for a kind of element (`ThemeSettings.elements`, `src/lib/theme-elements.ts`): the settings of a part
 * that make sense for every row, heading, paragraph, list or button of a store, each at the sizes a part can set them at.
 */
export type ThemeElement = {
  style?: Spacing;
  border?: Border;
  radius?: number;
  shadow?: Shadow;
  shadowOpacity?: number;
  /** A row's colour behind it. */
  background?: ColorBackground;
  /** A row's width (D190): the content's (the default) or the whole screen's, as `PageRow.width`; a row's own choice wins. */
  width?: "content" | "full";
  /** In a full-width row, whether what is in it spreads too (D190), as `PageRow.contentWidth`; a row's own choice wins. */
  contentWidth?: "content" | "full";
  at?: SizeOverrides;
  typography?: TypographyGroups;
};

/** Settings left out are none; an element with nothing set is left out. */
export const themeElementSchema = z
  .object({
    style: spacing,
    border: borderSchema,
    radius: radiusSchema,
    shadow: shadowSchema,
    shadowOpacity: shadowOpacitySchema,
    background: colorBackground.optional(),
    width: z.enum(["content", "full"]).optional(),
    contentWidth: z.enum(["content", "full"]).optional(),
    at: sizeOverrides,
    typography: typographyGroupsSchema,
  })
  .transform((value) => {
    const kept = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as ThemeElement;
    return Object.keys(kept).length > 0 ? kept : undefined;
  });
