import { z } from "zod";

import { FIELD_LABEL_MAX, REFUSAL_MAX, RULE_CONDITIONS_MAX, type CheckoutRule, type RuleCondition, type RuleEffect } from "./checkout-rules";

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
]) as z.ZodType<RuleEffect>;

export const ruleInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  conditions: z.array(conditionSchema).max(RULE_CONDITIONS_MAX).default([]),
  effect: effectSchema,
});

export type RuleInput = Omit<CheckoutRule, "id">;

export const fieldInputSchema = z.object({
  kind: z.enum(["text", "checkbox"]),
  required: z.boolean().default(false),
  label: words(FIELD_LABEL_MAX),
  help: words(200).nullable().default(null),
});

export type FieldInput = z.infer<typeof fieldInputSchema>;
