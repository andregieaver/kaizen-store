import { z } from "zod";

import { hoverTimingSchema } from "./hover-timing";
import {
  BACKGROUND_IDS,
  DELAY_MAX,
  DURATION_MAX,
  DURATION_MIN,
  ENTER_IDS,
  HOVER_IDS,
  MOTION_DISTANCES,
  MOTION_EASES,
  MOTION_INTENSITIES,
  MOTION_SPEEDS,
  MOTION_STARTS,
  type MotionDistance,
  type MotionEase,
  type MotionIntensity,
  type MotionSpeed,
  type MotionStart,
  SCROLL_IDS,
  STAGGER_MAX,
} from "./motion";

/**
 * The motion settings' schemas (D182, bloat review step 2.46), apart from the effect catalogues and helpers in motion.ts, so a
 * screen that only lists or draws an effect loads no zod. Import this file only where a schema runs.
 */

/** A focal point's schema, shared by a part's gradient and a saved one. */
export const gradientFocusSchema = z.object({ x: z.number().int().min(0).max(100), y: z.number().int().min(0).max(100) });

const speed = z.enum(Object.keys(MOTION_SPEEDS) as [MotionSpeed, ...MotionSpeed[]]).optional();
const intensity = z.enum(Object.keys(MOTION_INTENSITIES) as [MotionIntensity, ...MotionIntensity[]]).optional();

const enterMotion = z.object({
  effect: z.enum(ENTER_IDS),
  speed,
  ease: z.enum(Object.keys(MOTION_EASES) as [MotionEase, ...MotionEase[]]).optional(),
  distance: z.enum(Object.keys(MOTION_DISTANCES) as [MotionDistance, ...MotionDistance[]]).optional(),
  delay: z.number().int().min(0).max(DELAY_MAX).optional(),
  duration: z.number().int().min(DURATION_MIN).max(DURATION_MAX).optional(),
  trigger: z.enum(["view", "load"]).optional(),
  start: z.enum(Object.keys(MOTION_STARTS) as [MotionStart, ...MotionStart[]]).optional(),
  once: z.boolean().optional(),
  stagger: z.number().int().min(0).max(STAGGER_MAX).optional(),
});

/** A part's motion (D128); an empty one is left out. */
export const partMotionSchema = z
  .object({
    enter: enterMotion.optional(),
    hover: z.object({ effect: z.enum(HOVER_IDS), intensity }).optional(),
    scroll: z.object({ effect: z.enum(SCROLL_IDS), intensity }).optional(),
    hoverTime: hoverTimingSchema,
  })
  .optional()
  .transform((motion) => (motion && (motion.enter || motion.hover || motion.scroll || motion.hoverTime) ? motion : undefined));

/** A row's or column's background motion (D128). */
export const backgroundMotionSchema = z.object({ effect: z.enum(BACKGROUND_IDS), intensity }).optional();
