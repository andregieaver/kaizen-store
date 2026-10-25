import { z } from "zod";

import { PRODUCT_KINDS } from "./product-input";
import { RULES_MAX } from "./term-rules";

/**
 * The AI manager's category tools (wave 6 unit A, D319, `docs/wave-6-catalogue.md` 3.4), pure: the arguments of `list_categories` and
 * `update_category`, with things named as the owner names them (a category by name or address, a manufacturer or a field by name, a price in the
 * store's own currency), turned into ids and minor units on the server (`src/server/category-tools.ts`), never by the model.
 */

const termRef = z.string().trim().min(1).max(80);

export const listCategoriesInput = z.object({
  kind: z.enum(["category", "tag"]).optional().describe("Only categories or only tags; leave out for both."),
});

const ruleCondition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("term"), name: termRef.describe("A category or tag filled by hand, by name or address."), not: z.boolean().optional() }),
  z.object({
    kind: z.literal("price"),
    min: z.number().min(0).max(10_000_000).nullable().optional().describe("Lowest price, in the store's own country's currency, with VAT (199.50)."),
    max: z.number().min(0).max(10_000_000).nullable().optional().describe("Highest price, as min."),
  }),
  z.object({ kind: z.literal("inStock") }),
  z.object({ kind: z.literal("manufacturer"), names: z.array(z.string().trim().min(1).max(200)).min(1).max(20) }),
  z.object({ kind: z.literal("option"), name: z.string().trim().min(1).max(60).describe("The option, as the store writes it: Size."), value: z.string().trim().min(1).max(120) }),
  z.object({
    kind: z.literal("field"),
    field: z.string().trim().min(1).max(80).describe("A public custom field shoppers can filter by, by its name or label."),
    value: z.string().trim().max(200).optional().describe("A choice (by its name or label), or yes or no."),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.object({ kind: z.literal("kind"), values: z.array(z.enum(PRODUCT_KINDS)).min(1) }),
  z.object({ kind: z.literal("newWithin"), days: z.number().int().min(1).max(365) }),
]);
export type CategoryRuleArg = z.infer<typeof ruleCondition>;

export const updateCategoryInput = z.object({
  category: termRef.describe("The category or tag, by name or address (list_categories)."),
  kind: z.enum(["category", "tag"]).optional().describe("Category or tag, when both have the name."),
  description: z
    .string()
    .trim()
    .max(5000)
    .nullable()
    .optional()
    .describe("Its description, shown above its products: plain sentences, paragraphs split by a blank line, in the store's main language. null removes it."),
  picture: z.string().trim().min(1).max(1000).nullable().optional().describe("Its picture's address in the media library; null removes it."),
  order: z
    .array(z.string().trim().min(1).max(200))
    .max(500)
    .optional()
    .describe("Products by handle, first to last: the order Featured follows. Products left out come after. Not for one filled by rules."),
  rules: z
    .object({
      match: z.enum(["all", "any"]).default("all"),
      conditions: z.array(ruleCondition).min(1).max(RULES_MAX),
    })
    .nullable()
    .optional()
    .describe(
      "Fill it automatically: the products that meet all (or any) of the conditions are in it, and leave when they no longer do; the products placed in it by hand are taken out. null fills it by hand again, keeping what matched.",
    ),
});
export type UpdateCategoryArgs = z.output<typeof updateCategoryInput>;

/** The change in words before the server reads the store (the category's own name and the rule in words come from `categoryApprovalWords()`). */
export function categoryApprovalSummary(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (input.description !== undefined) parts.push(input.description === null ? "remove its description" : "set its description");
  if (input.picture !== undefined) parts.push(input.picture === null ? "remove its picture" : "set its picture");
  if (Array.isArray(input.order)) parts.push(`put ${input.order.length} products in order`);
  if (input.rules !== undefined) parts.push(input.rules === null ? "fill it by hand again" : "fill it by rules");
  return `Change ${typeof input.category === "string" ? `"${input.category}"` : "the category"}: ${parts.join(", ") || "nothing"}.`;
}
