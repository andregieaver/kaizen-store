/**
 * What the automation editor sends (wave 3, D238, `docs/wave-3-notifications.md` 2.5 and 4.9), checked in the browser and again by `saveRule()`. Zod, so
 * admin only (the storefront never loads it). A tag is held to `normaliseTag()`; the server keeps the product ids and countries to the store's own.
 */
import { z } from "zod";

import { normaliseTag } from "./order-tags";
import { RULE_DELIVERIES, RULE_LIMITS, RULE_SOURCES, type RuleAction, type RuleCondition } from "./order-rules";

const AMOUNT_MAX = 1_000_000_000_000;
const amount = z.number().int("Write a whole amount.").min(0, "An amount cannot be below zero.").max(AMOUNT_MAX, "That amount is too large.");
const uniq = <T extends z.ZodType<string>>(item: T, max: number, what: string) =>
  z
    .array(item)
    .min(1, `Choose at least one ${what}.`)
    .max(max, `Choose at most ${max} ${what}s.`)
    .transform((list) => [...new Set(list)]);

const tagText = z.string().transform((value, ctx) => {
  const result = normaliseTag(value);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: "Write a tag of at most 40 characters, without commas." });
    return z.NEVER;
  }
  return result.tag;
});

export const ruleConditionInput: z.ZodType<RuleCondition, unknown> = z.union([
  z.object({ kind: z.literal("total_at_least"), amountMinor: amount }),
  z.object({ kind: z.literal("total_below"), amountMinor: amount }),
  z.object({ kind: z.literal("country_in"), countries: uniq(z.string().regex(/^[A-Z]{2}$/, "Choose a country."), RULE_LIMITS.countries, "country") }),
  z.object({ kind: z.literal("buyer_is"), buyer: z.enum(["business", "consumer"]) }),
  z.object({ kind: z.literal("first_order"), value: z.boolean() }),
  z.object({ kind: z.literal("has_product"), productIds: uniq(z.uuid("Choose a product."), RULE_LIMITS.products, "product") }),
  z.object({ kind: z.literal("delivery_is"), deliveries: uniq(z.enum(RULE_DELIVERIES), RULE_DELIVERIES.length, "delivery") }),
  z.object({ kind: z.literal("has_backorder") }),
  z.object({ kind: z.literal("is_gift") }),
  z.object({ kind: z.literal("source_is"), sources: uniq(z.enum(RULE_SOURCES), RULE_SOURCES.length, "source") }),
  z
    .object({ kind: z.literal("has_tag"), tag: tagText })
    .transform(({ tag }) => ({ kind: "has_tag" as const, tagKey: tag.key, label: tag.label })),
  z.object({ kind: z.literal("seller_is"), seller: z.enum(["store", "host"]) }),
]);

const text = (max: number, empty: string) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, empty).max(max, `At most ${max} characters.`));

export const ruleActionInput: z.ZodType<RuleAction, unknown> = z.union([
  z.object({ kind: z.literal("tag"), label: tagText }).transform(({ label }) => ({ kind: "tag" as const, label: label.label })),
  z.object({ kind: z.literal("notify"), note: text(RULE_LIMITS.note, "Write what staff should know.") }),
  z.object({ kind: z.literal("hold"), reason: text(RULE_LIMITS.reason, "Write why the order is held.") }),
]);

export const orderRuleInput = z.object({
  name: text(RULE_LIMITS.name, "Give the rule a name."),
  match: z.enum(["all", "any"]).default("all"),
  enabled: z.boolean().default(true),
  conditions: z.array(ruleConditionInput).max(RULE_LIMITS.conditions, `A rule has at most ${RULE_LIMITS.conditions} conditions.`),
  actions: z.array(ruleActionInput).min(1, "Add an action.").max(RULE_LIMITS.actions, `A rule has at most ${RULE_LIMITS.actions} actions.`),
});
export type OrderRuleInput = z.infer<typeof orderRuleInput>;

/** The rule's ids in the order the list shows them (*Move up*, *Move down*, dragging). */
export const ruleOrderInput = z.array(z.uuid()).max(RULE_LIMITS.rules);
