import { z } from "zod";

import { FIELD_NUMBERS, LABEL_EASINGS, MOTION_NUMBERS, type FieldNumber, type FieldStyle, type LabelEasing, type MotionNumber } from "./form-field-style";
import { color } from "./part-styles";

/**
 * The schema of `form-field-style.ts` (D878), apart from it so the site's form does not load zod (D211). Part of the page's JSON, on each
 * form component.
 */

const WORDS: Record<FieldNumber | MotionNumber, string> = {
  borderWidth: "A field's border",
  radius: "A field's corner radius",
  padY: "A field's padding above and below",
  padX: "A field's padding at the sides",
  gap: "The space between questions",
  textSize: "A field's text size",
  duration: "A label's movement",
  movedSize: "A moved label's size",
  spacing: "A moved label's letter spacing",
  lift: "The space above a field",
};

const bounded = (key: FieldNumber | MotionNumber, { min, max }: { min: number; max: number }, whole = true) => {
  const n = z.number(`${WORDS[key]} is a number.`).min(min, `${WORDS[key]} is at least ${min}.`).max(max, `${WORDS[key]} is at most ${max}.`);
  return (whole ? n.int(`${WORDS[key]} is a whole number.`) : n).optional();
};

const labelMotion = z.object({
  case: z.enum(["switch", "keep"], "A label turns to capitals in an unknown way.").optional(),
  align: z.literal("text", "A moved label lines up in an unknown way.").optional(),
  duration: bounded("duration", MOTION_NUMBERS.duration),
  easing: z.enum(Object.keys(LABEL_EASINGS).filter((k) => k !== "smooth") as [Exclude<LabelEasing, "smooth">, ...Exclude<LabelEasing, "smooth">[]], "A label moves with an unknown easing.").optional(),
  movedSize: bounded("movedSize", MOTION_NUMBERS.movedSize, false),
  spacing: bounded("spacing", MOTION_NUMBERS.spacing, false),
  lift: bounded("lift", MOTION_NUMBERS.lift),
  placeholder: z.literal(false).optional(),
});

export const fieldStyleSchema: z.ZodType<FieldStyle> = z.object({
  labels: z.enum(["placeholder", "animated"], "A form's labels are shown in an unknown way.").optional(),
  look: z.enum(["filled", "underline"], "A form's fields have an unknown look.").optional(),
  background: color.optional(),
  text: color.optional(),
  border: color.optional(),
  focus: color.optional(),
  label: color.optional(),
  placeholder: color.optional(),
  borderWidth: bounded("borderWidth", FIELD_NUMBERS.borderWidth),
  radius: bounded("radius", FIELD_NUMBERS.radius),
  padY: bounded("padY", FIELD_NUMBERS.padY),
  padX: bounded("padX", FIELD_NUMBERS.padX),
  gap: bounded("gap", FIELD_NUMBERS.gap),
  textSize: bounded("textSize", FIELD_NUMBERS.textSize),
  motion: labelMotion.optional(),
});
