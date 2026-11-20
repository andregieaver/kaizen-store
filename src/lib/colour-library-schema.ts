import { z } from "zod";

import { GRADIENT_COLORS_MAX, GRADIENT_COLORS_MIN, GRADIENT_FLOWS, GRADIENT_STYLES, type GradientFlow, type GradientStyle } from "./motion";
import { gradientFocusSchema } from "./motion-schema";
import { LIBRARY_NAME_MAX, SAVED_COLOURS_MAX, SAVED_GRADIENTS_MAX } from "./colour-library";

/**
 * A store's saved colours and gradients as they are checked (D180, bloat review step 2.46), apart from the limits and helpers in
 * colour-library.ts, so a screen that only shows or picks a saved colour loads no zod. Import this file only where a schema runs.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits, like #1f2937.").transform((v) => v.toLowerCase());
const itemId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const name = z.string().trim().min(1, "Give it a name.").max(LIBRARY_NAME_MAX, `Keep the name under ${LIBRARY_NAME_MAX} characters.`);

export const colourLibrarySchema = z.object({
  colours: z.array(z.object({ id: itemId, name, color: hex })).max(SAVED_COLOURS_MAX, `Keep at most ${SAVED_COLOURS_MAX} saved colours.`),
  gradients: z
    .array(
      z.object({
        id: itemId,
        name,
        style: z.enum(Object.keys(GRADIENT_STYLES) as [GradientStyle, ...GradientStyle[]]),
        colors: z.array(hex).min(GRADIENT_COLORS_MIN).max(GRADIENT_COLORS_MAX),
        angle: z.number().int().min(0).max(360).optional(),
        focus: gradientFocusSchema.optional(),
        flow: z.enum(Object.keys(GRADIENT_FLOWS) as [GradientFlow, ...GradientFlow[]]).optional(),
        grain: z.boolean().optional(),
      }),
    )
    .max(SAVED_GRADIENTS_MAX, `Keep at most ${SAVED_GRADIENTS_MAX} saved gradients.`),
});
