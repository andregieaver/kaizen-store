import { z } from "zod";

import { FONT_WEIGHTS, HIGHLIGHT_HEIGHTS, SLUG_SHAPE, TEXT_STYLE_CSS_MAX, TEXT_STYLE_KINDS, TEXT_STYLE_NAME_MAX, UNDERLINE_STYLES } from "./text-styles";

/** What the builder sends to save a text style (D393): checked here and again by the server's writer. */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits.").transform((c) => c.toLowerCase());

export const textStyleSettingsSchema = z
  .object({
    colors: z.array(hex).min(2).max(3).optional(),
    color: hex.optional(),
    angle: z.number().int().min(0).max(360).optional(),
    size: z.number().int().min(1).max(30).optional(),
    underline: z.enum(UNDERLINE_STYLES).optional(),
    highlight: z.enum(HIGHLIGHT_HEIGHTS).optional(),
    weight: z
      .number()
      .int()
      .refine((w): w is (typeof FONT_WEIGHTS)[number] => (FONT_WEIGHTS as readonly number[]).includes(w), "A weight is one of the font's weights.")
      .optional(),
    spacing: z.number().int().min(5).max(50).optional(),
  })
  .strict();

export const textStyleInput = z.object({
  /** An existing style's slug; none makes a new one. */
  slug: z.string().regex(SLUG_SHAPE).optional(),
  name: z
    .string()
    .trim()
    .min(1, "Give the style a name.")
    .max(TEXT_STYLE_NAME_MAX, `A style's name is at most ${TEXT_STYLE_NAME_MAX} characters.`),
  kind: z.enum(TEXT_STYLE_KINDS),
  settings: textStyleSettingsSchema,
  css: z.string().max(TEXT_STYLE_CSS_MAX, `A style's CSS is at most ${TEXT_STYLE_CSS_MAX} characters.`).nullable().optional(),
});
export type TextStyleInput = z.infer<typeof textStyleInput>;
