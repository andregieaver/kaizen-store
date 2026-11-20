import { z } from "zod";

import { BUTTON_HOVER_IDS, HOVER_DURATION_MAX, HOVER_EASE_IDS } from "./hover-timing";

/**
 * The hover timings' schemas (bloat review step 2.46), apart from the eases, button hovers and CSS variables in hover-timing.ts,
 * so a screen that only draws a hover loads no zod. Import this file only where a schema runs.
 */

export const hoverTimingSchema = z
  .object({
    duration: z.number().int().min(0).max(HOVER_DURATION_MAX, `A hover takes at most ${HOVER_DURATION_MAX / 1000} seconds.`).optional(),
    ease: z.enum(HOVER_EASE_IDS).optional(),
  })
  .optional()
  .transform((timing) => (timing && (timing.duration !== undefined || timing.ease) ? timing : undefined));

export const themeHoverSchema = z
  .object({
    duration: z.number().int().min(0).max(HOVER_DURATION_MAX).optional(),
    ease: z.enum(HOVER_EASE_IDS).optional(),
    button: z.enum(BUTTON_HOVER_IDS).optional(),
  })
  .optional();
