import { z } from "zod";

import { RFM_SEGMENTS } from "./rfm-segments";
import { tagKey } from "./order-tags";
import { CATEGORIES_PER_CONDITION, CONDITIONS_MAX, CONSENTS, type Consent, PRODUCTS_PER_CONDITION, SMS_CONSENTS } from "./segments";

/**
 * The schemas of segments.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; segments.ts imports it as a type alone.
 */

const count = z.number().int().min(0).max(1_000_000);
/** What an empty list says (`marketingProblem()` says it in the account's language): the editor counts as conditions change, so it is seen. */
const CHOOSE_SOME = "Choose at least one.";
const days = z.number().int().min(1).max(3650);
const codes = (max: number) => z.array(z.string().regex(/^[a-z]{2}$/i).transform((c) => c.toLowerCase())).min(1, CHOOSE_SOME).max(max);

/** The twelve conditions segments had before ecosystem plan E3.6 (D718); `MORE_CONDITIONS` are E3.6's. */
const FIRST_CONDITIONS = [
  z.object({ kind: z.literal("consent"), statuses: z.array(z.enum(CONSENTS as [Consent, ...Consent[]])).min(1, CHOOSE_SOME).max(4) }),
  z.object({ kind: z.literal("orders"), op: z.enum(["atLeast", "atMost", "exactly"]), value: count }),
  z.object({ kind: z.literal("spent"), op: z.enum(["atLeast", "atMost"]), minor: z.number().int().min(0).max(1_000_000_000_00) }),
  z.object({ kind: z.literal("lastOrder"), op: z.enum(["within", "before", "never"]), days: days.optional() }),
  z.object({ kind: z.literal("firstOrder"), op: z.enum(["within", "before"]), days }),
  z.object({ kind: z.literal("rfm"), groups: z.array(z.enum(RFM_SEGMENTS)).min(1, CHOOSE_SOME).max(RFM_SEGMENTS.length) }),
  z.object({ kind: z.literal("country"), codes: codes(60) }),
  z.object({ kind: z.literal("language"), codes: codes(40) }),
  z.object({ kind: z.literal("group"), ids: z.array(z.uuid()).min(1, CHOOSE_SOME).max(50) }),
  z.object({ kind: z.literal("company"), has: z.boolean() }),
  z.object({ kind: z.literal("account"), has: z.boolean() }),
  z.object({ kind: z.literal("tag"), tags: z.array(z.string().max(80)).min(1, CHOOSE_SOME).max(20) }),
] as const;

/**
 * The conditions ecosystem plan E3.6 (D718) added: what a person bought (products, or a category's products; ever or in the last days; or
 * not), their deals, support conversations, reviews, subscriptions and consent to texts. Email engagement (M2.4) is presses on links, kept per
 * person since M1.3 for broadcasts and D767 for flows; the store keeps no opens.
 */
const MORE_CONDITIONS = [
  z.object({ kind: z.literal("bought"), has: z.boolean(), products: z.array(z.uuid()).min(1, CHOOSE_SOME).max(PRODUCTS_PER_CONDITION), days: days.optional() }),
  z.object({ kind: z.literal("boughtCategory"), has: z.boolean(), categories: z.array(z.uuid()).min(1, CHOOSE_SOME).max(CATEGORIES_PER_CONDITION), days: days.optional() }),
  z.object({ kind: z.literal("deal"), status: z.enum(["open", "won"]) }),
  z.object({ kind: z.literal("support"), op: z.enum(["within", "ratedBad"]), days: days.optional() }),
  z.object({ kind: z.literal("review"), maxStars: z.number().int().min(1).max(5).optional() }),
  z.object({ kind: z.literal("subscription"), has: z.boolean() }),
  z.object({ kind: z.literal("sms"), statuses: z.array(z.enum(SMS_CONSENTS)).min(1, CHOOSE_SOME).max(SMS_CONSENTS.length) }),
  // Email engagement (email plan M2.4): pressed a link in the store's emails in the last days, or none within the clicks kept.
  z.object({ kind: z.literal("clicked"), op: z.enum(["within", "never"]), days: days.optional() }),
  // Products a signed-in customer looked at (M2.4), kept only while a browse email runs (D691): ever (of those kept) or in the last days, or not.
  z.object({ kind: z.literal("viewed"), has: z.boolean(), products: z.array(z.uuid()).min(1, CHOOSE_SOME).max(PRODUCTS_PER_CONDITION), days: days.optional() }),
  // A customer's field marked for marketing (M2.4), by the field's id: what it says, or whether it is filled in.
  z.object({ kind: z.literal("field"), field: z.string().min(1, CHOOSE_SOME).max(80), op: z.enum(["is", "isNot", "filled", "empty"]), value: z.string().trim().max(200).optional() }),
  // A business customer's lead score (M2.8, D865): at least this many points out of 100.
  z.object({ kind: z.literal("leadScore"), min: z.number().int().min(1).max(100) }),
] as const;

export const conditionSchema = z.discriminatedUnion("kind", [...FIRST_CONDITIONS, ...MORE_CONDITIONS]);
export type Condition = z.infer<typeof conditionSchema>;

/** What a rule set must say beyond its shape: days where a condition counts them, tags that are tags. */
function checkRules<T extends { conditions: readonly Condition[] }>(rules: T, ctx: z.RefinementCtx<T>) {
  rules.conditions.forEach((c, i) => {
    const noDays = (c.kind === "lastOrder" && c.op !== "never") || (c.kind === "support" && c.op === "within") || (c.kind === "clicked" && c.op === "within");
    if (noDays && c.days === undefined) ctx.addIssue({ code: "custom", path: ["conditions", i, "days"], message: "Give a number of days." });
    if (c.kind === "field" && (c.op === "is" || c.op === "isNot") && !c.value) ctx.addIssue({ code: "custom", path: ["conditions", i, "value"], message: "Say what it should say." });
    if (c.kind === "tag" && c.tags.some((t) => tagKey(t) === null)) ctx.addIssue({ code: "custom", path: ["conditions", i, "tags"], message: "A tag is not valid." });
  });
}

export const segmentRulesSchema = z
  .object({ match: z.enum(["all", "any"]), conditions: z.array(conditionSchema).max(CONDITIONS_MAX) })
  .superRefine(checkRules);
export type SegmentRules = z.infer<typeof segmentRulesSchema>;


export const segmentInput = z.object({
  name: z.string().trim().min(1, "Give the segment a name.").max(80),
  rules: segmentRulesSchema,
});
export type SegmentInput = z.infer<typeof segmentInput>;
