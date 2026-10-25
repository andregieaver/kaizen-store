/**
 * Collections filled by rules (wave 6 unit A2, D319, `docs/wave-6-catalogue.md` 3.3), pure and shared with the browser: a store's product category
 * or tag whose `terms.rules` is set holds the products that meet its conditions, worked out each time it is read by the database's one evaluator
 * (`commerce.product_matches_rules()`, through `commerce.in_terms()`), so membership follows every change to a product with nothing re-run.
 *
 * A condition is data, never SQL: its kind is one of `RULE_KINDS` and every value is checked here, then each id against the store on the server
 * (`keepOwnRuleIds()` there). A new kind is a case in `conditionSchema`, `describeCondition()`, `newCondition()`, the editor and the SQL evaluator,
 * with a test.
 */
import { z } from "zod";

import { PRODUCT_KINDS } from "./product-input";

/** The most conditions one collection holds. */
export const RULES_MAX = 10;
/** The most manufacturers or kinds one condition names. */
const LIST_MAX = 20;
const uuid = z.uuid();

export const RULE_KINDS = ["term", "price", "inStock", "manufacturer", "option", "field", "kind", "newWithin"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

/** A whole number of minor units, or none. */
const minor = z.number().int().min(0).max(1_000_000_000).nullable().default(null);

const termCondition = z.object({ kind: z.literal("term"), termId: uuid, not: z.boolean().default(false) });
const priceCondition = z
  .object({ kind: z.literal("price"), min: minor, max: minor })
  .refine((c) => c.min !== null || c.max !== null, "Give a lowest or a highest price.")
  .refine((c) => c.min === null || c.max === null || c.min <= c.max, "The lowest price is above the highest.");
const stockCondition = z.object({ kind: z.literal("inStock") });
const manufacturerCondition = z.object({ kind: z.literal("manufacturer"), ids: z.array(uuid).min(1, "Choose a manufacturer.").max(LIST_MAX) });
const optionCondition = z.object({
  kind: z.literal("option"),
  name: z.string().trim().min(1, "Name the option.").max(60),
  value: z.string().trim().min(1, "Give the option's value.").max(120),
});
const fieldCondition = z
  .object({
    kind: z.literal("field"),
    fieldId: z.string().trim().min(1).max(64),
    value: z.string().trim().max(200).nullable().default(null),
    min: z.number().finite().nullable().default(null),
    max: z.number().finite().nullable().default(null),
    /** A measurement field's unit, which the range is in: the field's first unit, set by the server from the field (never typed). */
    unit: z.string().trim().max(20).nullable().default(null),
  })
  .refine((c) => c.value !== null || c.min !== null || c.max !== null, "Give the field's value or a range.");
const kindCondition = z.object({ kind: z.literal("kind"), values: z.array(z.enum(PRODUCT_KINDS)).min(1, "Choose a kind of product.").max(PRODUCT_KINDS.length) });
const newCondition_ = z.object({ kind: z.literal("newWithin"), days: z.number().int().min(1, "At least one day.").max(365, "At most a year.") });

export const conditionSchema = z.union([termCondition, priceCondition, stockCondition, manufacturerCondition, optionCondition, fieldCondition, kindCondition, newCondition_]);
export type RuleCondition = z.infer<typeof conditionSchema>;

export const termRulesSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(conditionSchema).min(1, "Add a condition.").max(RULES_MAX, `A collection has at most ${RULES_MAX} conditions.`),
});
export type TermRules = z.infer<typeof termRulesSchema>;

/** What is stored, read leniently: rules that no longer parse are none (the term holds no products until it is saved again). */
export function parseTermRules(value: unknown): TermRules | null {
  if (value === null || value === undefined) return null;
  const parsed = termRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A new condition of a kind, with the values the editor starts from. */
export function newCondition(kind: RuleKind): RuleCondition {
  switch (kind) {
    case "term":
      return { kind, termId: "", not: false } as unknown as RuleCondition;
    case "price":
      return { kind, min: null, max: null };
    case "inStock":
      return { kind };
    case "manufacturer":
      return { kind, ids: [] };
    case "option":
      return { kind, name: "", value: "" };
    case "field":
      return { kind, fieldId: "", value: null, min: null, max: null, unit: null };
    case "kind":
      return { kind, values: ["goods"] };
    case "newWithin":
      return { kind, days: 30 };
  }
}

/** The names a condition's words need: terms, manufacturers and fields by id, and how an amount is written. */
export type RuleNames = {
  terms: ReadonlyMap<string, { name: string; kind: "category" | "tag" }>;
  manufacturers: ReadonlyMap<string, string>;
  fields: ReadonlyMap<string, string>;
  money: (minor: number) => string;
  kinds: Record<string, string>;
};

/** The words for a condition (English: the owner's admin words come from its catalogue where it shows them; the AI manager reads these). */
export function describeCondition(c: RuleCondition, names: RuleNames): string {
  switch (c.kind) {
    case "term": {
      const term = names.terms.get(c.termId);
      const label = term ? `${term.kind === "tag" ? "tag" : "category"} ${term.name}` : "a category or tag that is gone";
      return c.not ? `not in ${label}` : `in ${label}`;
    }
    case "price":
      return c.min !== null && c.max !== null
        ? `priced from ${names.money(c.min)} to ${names.money(c.max)}`
        : c.min !== null
          ? `priced from ${names.money(c.min)}`
          : `priced up to ${names.money(c.max ?? 0)}`;
    case "inStock":
      return "in stock";
    case "manufacturer":
      return `made by ${c.ids.map((id) => names.manufacturers.get(id) ?? "a manufacturer that is gone").join(" or ")}`;
    case "option":
      return `${c.name} is ${c.value}`;
    case "field": {
      const label = names.fields.get(c.fieldId) ?? "a field that is gone";
      if (c.value !== null) return `${label} is ${c.value}`;
      if (c.min !== null && c.max !== null) return `${label} from ${c.min} to ${c.max}`;
      return c.min !== null ? `${label} from ${c.min}` : `${label} up to ${c.max}`;
    }
    case "kind":
      return `a ${c.values.map((k) => names.kinds[k] ?? k).join(" or ")}`;
    case "newWithin":
      return `added in the last ${c.days} ${c.days === 1 ? "day" : "days"}`;
  }
}

/** The whole rule in a sentence: "Products in category Lamps and priced up to 500,00 kr". */
export function describeRules(rules: TermRules, names: RuleNames): string {
  const joiner = rules.match === "any" ? " or " : " and ";
  return `Products ${rules.conditions.map((c) => describeCondition(c, names)).join(joiner)}`;
}

/** The term ids a rule names (in a `term` condition), so the server can check them and a copy remap them. */
export function ruleTermIds(rules: TermRules): string[] {
  return [...new Set(rules.conditions.flatMap((c) => (c.kind === "term" ? [c.termId] : [])))];
}

/** The manufacturer ids a rule names. */
export function ruleManufacturerIds(rules: TermRules): string[] {
  return [...new Set(rules.conditions.flatMap((c) => (c.kind === "manufacturer" ? c.ids : [])))];
}

/** The field ids a rule names. */
export function ruleFieldIds(rules: TermRules): string[] {
  return [...new Set(rules.conditions.flatMap((c) => (c.kind === "field" ? [c.fieldId] : [])))];
}

/**
 * The rule with only the ids the store owns (`own`), each condition that names none left out: what is saved (D179's `keepOwnRuleIds()` does the same
 * for visibility rules). Null when nothing is left.
 */
export function keepOwnIds(
  rules: TermRules,
  own: { terms: ReadonlySet<string>; manufacturers: ReadonlySet<string>; fields: ReadonlySet<string> },
): TermRules | null {
  const conditions = rules.conditions.flatMap((c): RuleCondition[] => {
    if (c.kind === "term") return own.terms.has(c.termId) ? [c] : [];
    if (c.kind === "manufacturer") {
      const ids = c.ids.filter((id) => own.manufacturers.has(id));
      return ids.length > 0 ? [{ ...c, ids }] : [];
    }
    if (c.kind === "field") return own.fields.has(c.fieldId) ? [c] : [];
    return [c];
  });
  return conditions.length > 0 ? { ...rules, conditions } : null;
}
