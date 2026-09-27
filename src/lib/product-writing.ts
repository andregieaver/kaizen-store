import { z } from "zod";

import { findClaims, type ClaimFinding } from "./claims";
import { DESCRIPTION_MAX, TITLE_MAX } from "./seo";

/**
 * AI product texts (Phase 2, S4, D76): the store's text model suggests a
 * description, a better description, search texts, or a translation from
 * the main language. It is given the product's own facts and nothing else
 * (never prices or stock), told not to add facts, and its answer is
 * cleaned to plain text here. Staff see the suggestion next to the field,
 * edit it, and copy it in themselves; nothing is saved until they save the
 * product. Suggestions carrying phrases the claims filter finds cannot be
 * used until staff take them out. Pure and shared with the browser.
 */

export const WRITE_KINDS = ["write", "improve", "seo", "translate"] as const;
export type WriteKind = (typeof WRITE_KINDS)[number];

/** The fields a suggestion fills. */
export type WrittenText = { title?: string; description?: string; seoTitle?: string; seoDescription?: string };
export type WrittenField = keyof WrittenText;

/** What the model is told about the product: its words, as staff have them in the editor. */
export const productFacts = z.object({
  kind: z.enum(["goods", "appointment", "stay", "rental"]),
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

/** Search texts are asked for at the length search engines show, within what the store keeps. */
const SEO_TITLE_WORDS = 60;
const SEO_DESCRIPTION_WORDS = 155;

const KIND_NAMES: Record<ProductFacts["kind"], string> = {
  goods: "a product",
  appointment: "a service booked for a time",
  stay: "a place to stay, booked by the night",
  rental: "an item for rent",
};

/** Which fields a kind of suggestion fills. */
export function fieldsFor(kind: WriteKind, facts: ProductFacts): WrittenField[] {
  if (kind === "seo") return ["seoTitle", "seoDescription"];
  if (kind === "translate") {
    return ["title", "description", ...(facts.seoTitle ? (["seoTitle"] as const) : []), ...(facts.seoDescription ? (["seoDescription"] as const) : [])];
  }
  return ["description"];
}

/** Whether there is enough to write from: a translation needs text, the rest a title. */
export function canWrite(kind: WriteKind, facts: ProductFacts): boolean {
  if (kind === "translate") return Boolean(facts.title || facts.description);
  if (kind === "improve") return Boolean(facts.description);
  return Boolean(facts.title);
}

/** The request to the text model. */
export function writingMessages(request: WriteRequest): { role: "system" | "user"; content: string }[] {
  const { kind, language, fromLanguage, facts } = request;
  const fields = fieldsFor(kind, facts);
  const task: Record<WriteKind, string> = {
    write: "Write a product description of two to four short paragraphs, at most 1,200 characters.",
    improve: "Rewrite the description so it reads clearly and well. Keep every fact in it and add none.",
    seo: `Write a title for search results of at most ${SEO_TITLE_WORDS} characters and a description for search results of at most ${SEO_DESCRIPTION_WORDS} characters.`,
    translate: `Translate the ${fields.join(", ")} from ${fromLanguage || "the language they are in"} into ${language}. Keep the meaning, the facts and the tone; translate nothing else and add nothing.`,
  };
  const system = [
    `You write texts for ${KIND_NAMES[facts.kind]} in an online store, in ${language}. Staff check and edit what you write before anyone sees it.`,
    "Use only the facts given. Never add a fact that is not given: no materials, sizes, weights, origins, certifications, awards, reviews, uses or benefits the facts do not state.",
    "Never mention prices, discounts, offers, delivery times or stock.",
    "Never make environmental claims (such as eco-friendly, sustainable, green or climate neutral), never create urgency or scarcity, never claim the best or lowest price, and never compare with other shops.",
    "Write plain text: no Markdown, no HTML, no emoji. Separate paragraphs with a blank line.",
    `Answer with one JSON object and nothing else, with these string fields: ${fields.join(", ")}.`,
  ].join("\n");
  const given = {
    title: facts.title,
    description: facts.description,
    ...(kind === "translate" && facts.seoTitle ? { seoTitle: facts.seoTitle } : {}),
    ...(kind === "translate" && facts.seoDescription ? { seoDescription: facts.seoDescription } : {}),
    ...(facts.categories.length > 0 ? { categories: facts.categories } : {}),
    ...(facts.tags.length > 0 ? { tags: facts.tags } : {}),
    ...(facts.options.length > 0 ? { options: facts.options } : {}),
  };
  return [
    { role: "system", content: system },
    { role: "user", content: `${task[kind]}\n\nFacts:\n${JSON.stringify(given, null, 2)}` },
  ];
}

const LIMITS: Record<WrittenField, number> = { title: 200, description: 10_000, seoTitle: TITLE_MAX, seoDescription: DESCRIPTION_MAX };

/** Plain text: tags, Markdown marks and stray spaces out, paragraphs kept, cut at a word within the field's limit. */
export function plainText(text: string, limit: number): string {
  const plain = text
    .replace(/<[^>]*>/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^[ \t]*#+[ \t]*/gm, "")
    .replace(/^[ \t]*[-*•][ \t]+/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (plain.length <= limit) return plain;
  const cut = plain.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return (space > limit * 0.6 ? cut.slice(0, space) : cut).trim();
}

/** The model's answer as the fields asked for, as plain text; null when it is not that. */
export function cleanWritten(answer: unknown, kind: WriteKind, facts: ProductFacts): WrittenText | null {
  if (!answer || typeof answer !== "object") return null;
  const record = answer as Record<string, unknown>;
  const written: WrittenText = {};
  for (const field of fieldsFor(kind, facts)) {
    const value = record[field];
    if (typeof value !== "string" || !value.trim()) return null;
    written[field] = plainText(value, LIMITS[field]);
  }
  return written;
}

/** What the claims filter finds in each field of a suggestion; empty when it may be used. */
export function writtenFindings(written: WrittenText): Partial<Record<WrittenField, ClaimFinding[]>> {
  const found: Partial<Record<WrittenField, ClaimFinding[]>> = {};
  for (const [field, text] of Object.entries(written) as [WrittenField, string | undefined][]) {
    const claims = text ? findClaims(text) : [];
    if (claims.length > 0) found[field] = claims;
  }
  return found;
}
