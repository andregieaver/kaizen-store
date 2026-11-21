import { z } from "zod";

import { DESCRIPTION_MAX, TITLE_MAX } from "./seo";
import { WRITE_KINDS } from "./product-writing";

/**
 * The schemas of product-writing.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; product-writing.ts imports it as a type alone.
 */

/** What the model is told about the product: its words, as staff have them in the editor. */
export const productFacts = z.object({
  kind: z.enum(["goods", "appointment", "stay", "rental", "gift_card", "bundle"]),
  title: z.string().trim().max(200),
  description: z.string().trim().max(10_000),
  seoTitle: z.string().trim().max(TITLE_MAX).default(""),
  seoDescription: z.string().trim().max(DESCRIPTION_MAX).default(""),
  categories: z.array(z.string().trim().max(80)).max(30).default([]),
  tags: z.array(z.string().trim().max(80)).max(30).default([]),
  options: z
    .array(z.object({ name: z.string().trim().max(40), values: z.array(z.string().trim().max(60)).max(50) }))
    .max(10)
    .default([]),
});
export type ProductFacts = z.infer<typeof productFacts>;

/** A request from the editor: what to write, in which language, from which facts. */
export const writeRequest = z.object({
  kind: z.enum(WRITE_KINDS),
  /** The language to write in, e.g. "Swedish"; the language's own name as the editor shows it. */
  language: z.string().trim().min(2).max(60),
  /** For a translation: the language the facts are in. */
  fromLanguage: z.string().trim().max(60).default(""),
  facts: productFacts,
});
export type WriteRequest = z.infer<typeof writeRequest>;
