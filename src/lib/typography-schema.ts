import { z } from "zod";

import { opacityValue } from "./colour-schema";
import { fontFamily } from "./fonts-schema";
import {
  FONT_SIZE_UNITS,
  LETTER_SPACING_LIMITS,
  LETTER_SPACING_UNITS,
  LINE_HEIGHT_LIMITS,
  LINE_HEIGHT_UNITS,
  round4,
  SHADOW_BLUR_MAX,
  SHADOW_OFFSET_MAX,
  SIZE_LIMITS,
  TEXT_ALIGNS,
  TEXT_DECORATIONS,
  TEXT_GRADIENT_COLORS,
  TEXT_ROLES,
  TEXT_STYLES,
  TEXT_TRANSFORMS,
  TEXT_VARIANTS,
  TEXT_WEIGHT_VALUES,
  type TextDecoration,
  type TextStyle,
  type TextTransform,
  type TextVariant,
  type TextWeight,
  type TypographyAlign,
} from "./typography";

/**
 * The schemas of typography (D179 phase 3, `typography.ts`): what a part's typography may hold, checked where a page is saved or read
 * (`page-content.ts`, `part-styles.ts`). Kept beside the plain helpers, as `docs/performance.md` asks, so the helpers a visitor's script
 * reads carry no zod (bloat review step 2.10).
 */

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

export const textGradientSchema = z.object({
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
export const typographyGroupsSchema = groups(z.object({ ...typographyShape, textShadow: shadowSchema.optional(), gradient: textGradientSchema.optional() }));
/** A smaller size's: the same, and a shadow can be none there. */
export const typographyAtSchema = groups(z.object({ ...typographyShape, textShadow: shadowSchema.nullable().optional(), gradient: textGradientSchema.nullable().optional() }));
