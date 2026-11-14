import { z } from "zod";

import {
  DELIVERY_PERCENT_MAX,
  DELIVERY_PERCENT_MIN,
  CHECKLIST_OPTIONS_MAX,
  CHECKOUT_FIELD_KINDS,
  DATE_DAYS_MAX,
  hasBounds,
  hasOptions,
  NUMBER_LIMIT,
  FIELD_LABEL_MAX,
  FIELD_WIDTHS,
  REFUSAL_MAX,
  RULE_CONDITIONS_MAX,
  type CheckoutRule,
  type DeliveryPrice,
  type RuleCondition,
  type RuleEffect,
} from "./checkout-rules";

/**
 * The shapes a checkout rule and a checkout field are saved in (wave 9 unit D, D357), for the admin's save and the AI manager; kept apart from
 * `checkout-rules.ts`, which the cart (a pay route) imports without zod.
 */

const uuid = z.uuid();
const ids = z.array(uuid).min(1).max(50);
const optionKey = z.string().regex(/^(flat|(method|pickup|local):[0-9a-f-]{36})$/i, "Choose a delivery option.");

const words = (max: number) =>
  z.object({
    text: z.string().trim().min(1).max(max),
    byLocale: z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), z.string().trim().max(max)).default({}),
  });

export const deliveryPriceSchema: z.ZodType<DeliveryPrice> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("free") }),
  z.object({ kind: z.literal("percent"), percent: z.int().min(DELIVERY_PERCENT_MIN).max(DELIVERY_PERCENT_MAX).refine((p) => p !== 0, "Choose a percentage other than 0.") }),
  z.object({
    kind: z.literal("amount"),
    amounts: z
      .record(z.string().regex(/^[A-Z]{3}$/), z.int().min(-10_000_000).max(10_000_000))
      .refine((a) => Object.keys(a).length > 0 && Object.keys(a).length <= 30, "Give an amount in at least one currency."),
  }),
]) as z.ZodType<DeliveryPrice>;

export const conditionSchema: z.ZodType<RuleCondition> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("country"), op: z.enum(["is", "is_not"]), countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(60) }),
  z.object({ kind: z.literal("total"), op: z.enum(["at_least", "below"]), amountMinor: z.int().min(0).max(1e12), currency: z.string().regex(/^[A-Z]{3}$/) }),
  z.object({ kind: z.literal("weight"), op: z.enum(["at_least", "below"]), grams: z.int().min(0).max(10_000_000) }),
  z.object({ kind: z.literal("product"), op: z.enum(["has", "has_not"]), ids }),
  z.object({ kind: z.literal("category"), op: z.enum(["has", "has_not"]), ids }),
  z.object({ kind: z.literal("tag"), op: z.enum(["has", "has_not"]), ids }),
  z.object({ kind: z.literal("group"), op: z.enum(["is", "is_not"]), ids }),
]) as z.ZodType<RuleCondition>;

export const effectSchema: z.ZodType<RuleEffect> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hide_shipping"), options: z.array(optionKey).min(1).max(30) }),
  z.object({ kind: z.literal("rename_shipping"), option: optionKey, label: words(FIELD_LABEL_MAX) }),
  z.object({ kind: z.literal("hide_payment_method"), methods: z.array(z.string().regex(/^[a-z_0-9]{2,40}$/)).min(1).max(20) }),
  z.object({ kind: z.literal("refuse"), message: words(REFUSAL_MAX) }),
  z.object({ kind: z.literal("order_delivery"), options: z.array(optionKey).min(1).max(30) }),
  z.object({ kind: z.literal("delivery_price"), options: z.array(optionKey).min(1).max(30), price: deliveryPriceSchema }),
]) as z.ZodType<RuleEffect>;

export const ruleInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  conditions: z.array(conditionSchema).max(RULE_CONDITIONS_MAX).default([]),
  effect: effectSchema,
});

export type RuleInput = Omit<CheckoutRule, "id">;

const checklistOption = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,40}$/)
    .optional()
    .describe("The option's id, kept with answers; left out on a new option, which gets one."),
  label: words(FIELD_LABEL_MAX),
  none: z.boolean().optional().describe("The option that says none of the others apply; ticking it clears the others. At most one."),
});

export const fieldInputSchema = z.object({
  kind: z
    .enum(CHECKOUT_FIELD_KINDS)
    .describe("text: one line; textarea: several lines; checkbox: one box; checklist: options to tick; select: one option from a list; radio: one option, all shown."),
  required: z.boolean().default(false),
  label: words(FIELD_LABEL_MAX),
  help: words(200).nullable().default(null),
  // Left out, a new question is full width and a changed one keeps its width (task 2).
  width: z.enum(FIELD_WIDTHS).optional().describe("How wide the cart draws it: full, or half (two halves next to each other share a line)."),
  // A tick list's, a select's or radio buttons' (tasks 3 and 4); checked with the rest of it by `checklistProblems()`.
  options: z
    .array(checklistOption)
    .max(CHECKLIST_OPTIONS_MAX)
    .optional()
    .describe("The options of a checklist (1 to 30), a select or radio buttons (2 to 30), in order. Only a checklist has a none option."),
  sensitive: z
    .boolean()
    .optional()
    .describe("The answer may be sensitive personal data (GDPR article 9, such as allergies): the shopper ticks an explicit consent with it."),
  // A number's or a date's (task 4); checked with its kind by `boundsProblems()`.
  bounds: z
    .object({
      min: z.int().min(-NUMBER_LIMIT).max(NUMBER_LIMIT).optional(),
      max: z.int().min(-NUMBER_LIMIT).max(NUMBER_LIMIT).optional(),
    })
    .optional()
    .describe("A number's lowest and highest value, or a date's earliest and latest day counted from today (0 to 730); each optional."),
});

/** A number's or a date's bounds' own rules: only those kinds have them, the lowest is not above the highest, and a date's days are 0 to 730. */
export function boundsProblems(input: Pick<z.infer<typeof fieldInputSchema>, "kind" | "bounds">): string[] {
  const b = input.bounds;
  if (!b || (b.min === undefined && b.max === undefined)) return [];
  if (!hasBounds(input.kind)) return ["Only a number or a date has a lowest and a highest answer."];
  const problems: string[] = [];
  if (b.min !== undefined && b.max !== undefined && b.min > b.max) problems.push("The lowest answer is above the highest.");
  if (input.kind === "date" && [b.min, b.max].some((d) => d !== undefined && (d < 0 || d > DATE_DAYS_MAX))) problems.push(`Count a date's days from today: 0 to ${DATE_DAYS_MAX}.`);
  return problems;
}

/**
 * The options' own rules, apart from the schema so the Admin API can extend it: a checklist has at least one option and at most one `none`; a
 * select or radio buttons at least two and no `none` (one choice is always one of them); no two options share an id; the other kinds have no
 * options. Sentences for the owner.
 */
export function checklistProblems(input: Pick<z.infer<typeof fieldInputSchema>, "kind" | "options">): string[] {
  const options = input.options ?? [];
  if (!hasOptions(input.kind)) return options.length > 0 ? ["Only a tick list, a dropdown or a choice of one has options."] : [];
  const problems: string[] = [];
  if (input.kind === "checklist") {
    if (options.filter((o) => !o.none).length === 0) problems.push("Give the tick list at least one option.");
    if (options.filter((o) => o.none).length > 1) problems.push("Only one option can be None of these.");
  } else {
    if (options.length < 2) problems.push("Give the question at least two options to choose from.");
    if (options.some((o) => o.none)) problems.push("Only a tick list has a None of these option.");
  }
  const ids = options.flatMap((o) => (o.id ? [o.id] : []));
  if (new Set(ids).size !== ids.length) problems.push("Two options have the same id.");
  return problems;
}

export type FieldInput = z.infer<typeof fieldInputSchema>;
