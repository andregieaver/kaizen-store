import { z } from "zod";

import { CONDITIONS_MAX, GROUPS_MAX, VALUES_MAX, conditionProblem } from "./visibility";

/**
 * A part's Display rules as they are checked (D179 phase 4, bloat review step 2.46): the condition and show schemas, apart from the
 * facts, labels and helpers in visibility.ts, so a screen that only draws or edits a rule loads no zod. Import this file only where a
 * schema runs; visibility.ts imports it as a type alone.
 */

const uuid = z.uuid("A condition names something that is not an id.");
const ids = z.array(uuid).max(VALUES_MAX, `A condition takes at most ${VALUES_MAX} choices.`).transform((list) => [...new Set(list)]);
const some = <T extends z.ZodType>(item: T) =>
  z.array(item).min(1, "Choose at least one for each condition.").max(VALUES_MAX, `A condition takes at most ${VALUES_MAX} choices.`);
/** A local date and time in the store's time zone, as `<input type="datetime-local">` gives it. */
const LOCAL_STAMP = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
/** An address parameter's name: what forms and links use, nothing that could be read as anything else. */
const PARAM = /^[A-Za-z0-9_.\-[\]]{1,64}$/;

const condition = z.discriminatedUnion("fact", [
  z.object({ fact: z.literal("signedIn"), op: z.literal("is"), value: z.boolean() }),
  z.object({ fact: z.literal("customerGroup"), op: z.enum(["in", "notIn"]), value: ids }),
  z.object({ fact: z.literal("company"), op: z.enum(["is", "in", "notIn"]), value: z.union([z.boolean(), ids]) }),
  z.object({ fact: z.literal("buyer"), op: z.enum(["is", "isNot"]), value: z.enum(["business", "private"]) }),
  z.object({ fact: z.literal("boughtBefore"), op: z.literal("is"), value: z.boolean() }),
  z.object({ fact: z.literal("country"), op: z.enum(["in", "notIn"]), value: some(z.string().regex(/^[A-Z]{2}$/, "A country is two capital letters.")) }),
  z.object({ fact: z.literal("language"), op: z.enum(["in", "notIn"]), value: some(z.string().regex(/^[a-z]{2,3}$/, "A language is its code, such as nb or en.")) }),
  z.object({ fact: z.literal("currency"), op: z.enum(["in", "notIn"]), value: some(z.string().regex(/^[A-Z]{3}$/, "A currency is its code, such as NOK.")) }),
  z.object({
    fact: z.literal("date"),
    op: z.literal("between"),
    value: z.object({
      from: z.string().regex(LOCAL_STAMP, "A date needs a day and a time.").optional(),
      to: z.string().regex(LOCAL_STAMP, "A date needs a day and a time.").optional(),
    }),
  }),
  z.object({ fact: z.literal("weekday"), op: z.enum(["in", "notIn"]), value: some(z.number().int().min(1).max(7)).transform((list) => [...new Set(list)].sort()) }),
  z.object({
    fact: z.literal("hour"),
    op: z.literal("between"),
    value: z.object({ from: z.string().regex(CLOCK, "A time of day is hh:mm."), to: z.string().regex(CLOCK, "A time of day is hh:mm.") }),
  }),
  z.object({
    fact: z.literal("cartValue"),
    op: z.enum(["gte", "lte", "between"]),
    value: z.object({
      currency: z.string().regex(/^[A-Z]{3}$/, "A cart value needs its currency."),
      min: z.number().int().min(0).max(1_000_000_000).optional(),
      max: z.number().int().min(0).max(1_000_000_000).optional(),
    }),
  }),
  z.object({ fact: z.literal("cartProduct"), op: z.enum(["in", "notIn"]), value: ids }),
  z.object({ fact: z.literal("cartCategory"), op: z.enum(["in", "notIn"]), value: ids }),
  z.object({
    fact: z.literal("query"),
    op: z.enum(["is", "isNot", "contains", "exists", "notExists"]),
    value: z.object({
      name: z.string().trim().regex(PARAM, "An address parameter's name is letters, digits, - _ . [ ] (up to 64)."),
      text: z.string().trim().max(200, "Keep an address parameter's value under 200 characters.").optional(),
    }),
  }),
], { error: "A condition asks about something unknown." });

export type Condition = z.infer<typeof condition>;

export const conditionSchema = condition.superRefine((c, ctx) => {
  const problem = conditionProblem(c);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});

/** A part's Display as stored: `always` is not stored (nothing set is always). */
export const showSchema = z.union([
  z.enum(["always", "never", "signedIn", "signedOut"]),
  z.object({
    rules: z
      .array(
        z
          .array(conditionSchema)
          .min(1, "A group of conditions needs at least one condition.")
          .max(CONDITIONS_MAX, `A group takes at most ${CONDITIONS_MAX} conditions.`),
      )
      .min(1, "Conditional logic needs at least one condition.")
      .max(GROUPS_MAX, `Conditional logic takes at most ${GROUPS_MAX} groups.`),
  }),
], { error: "A part's display is unknown." });
