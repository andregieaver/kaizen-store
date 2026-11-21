import { z } from "zod";

import { BROADCAST_AUDIENCES } from "./broadcast-status";
import {
  ADDRESS_MAX,
  ALT_MAX,
  BLOCKS_MAX,
  BUTTON_MAX,
  HEADING_MAX,
  PARAGRAPH_MAX,
  PREVIEW_MAX,
  SUBJECT_CHOICES,
  SUBJECT_MAX,
  isBroadcastAddress,
  rewritableTexts,
} from "./broadcasts";

/**
 * The schemas of broadcasts.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; broadcasts.ts imports it as a type alone.
 */

const address = z.string().trim().refine(isBroadcastAddress, "Write a full address starting with https://, or a path of your store such as /products.");
const words = (max: number, what: string) => z.string().trim().min(1, `${what} is empty.`).max(max, `${what} is longer than ${max} characters.`);

export const broadcastBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: words(HEADING_MAX, "A heading") }),
  z.object({ type: z.literal("paragraph"), text: words(PARAGRAPH_MAX, "A paragraph") }),
  z.object({ type: z.literal("button"), text: words(BUTTON_MAX, "A button's words"), url: address }),
  z.object({
    type: z.literal("image"),
    url: z.string().trim().url("Choose a picture.").max(ADDRESS_MAX),
    alt: z.string().trim().max(ALT_MAX, `A picture's description is longer than ${ALT_MAX} characters.`),
    href: address.nullable().optional(),
  }),
  z.object({ type: z.literal("divider") }),
  // The store's own facts (D352): a product or a running campaign by id, drawn by code for each recipient's market when the email is made
  // (`EmailFacts`); `label` is only what the editor shows. A product links to its page by its address (`/p/{handle}`, which a renamed product
  // redirects); one the market no longer offers, or a campaign that ended, is left out of the email.
  z.object({
    type: z.literal("product"),
    product: z.uuid(),
    handle: z.string().trim().min(1).max(200).regex(/^[a-z0-9-]+$/, "A product's address is lower-case letters, digits and hyphens."),
    label: z.string().trim().max(200).default(""),
  }),
  z.object({ type: z.literal("campaign"), campaign: z.uuid(), label: z.string().trim().max(200).default("") }),
]);
export type BroadcastBlock = z.infer<typeof broadcastBlockSchema>;

export const languageContentSchema = z.object({
  subject: z.string().trim().max(SUBJECT_MAX, `The subject is longer than ${SUBJECT_MAX} characters.`),
  preview: z.string().trim().max(PREVIEW_MAX, `The preview line is longer than ${PREVIEW_MAX} characters.`),
  blocks: z.array(broadcastBlockSchema).max(BLOCKS_MAX, `At most ${BLOCKS_MAX} parts.`),
});
export type LanguageContent = z.infer<typeof languageContentSchema>;

export const broadcastContentSchema = z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), languageContentSchema);
export type BroadcastContent = z.infer<typeof broadcastContentSchema>;

export const broadcastInput = z
  .object({
    title: z.string().trim().min(1, "Give it a name.").max(80, "The name is longer than 80 characters."),
    audience: z.enum(BROADCAST_AUDIENCES),
    segmentId: z.uuid().nullable(),
    content: broadcastContentSchema,
  })
  .superRefine((value, ctx) => {
    if (value.audience === "segment" && !value.segmentId) ctx.addIssue({ code: "custom", message: "Choose a segment.", path: ["segmentId"] });
  });

const suggestionSchema = z.object({
  subject: z.string().trim().min(1).max(SUBJECT_MAX),
  preview: z.string().trim().max(PREVIEW_MAX).default(""),
  heading: z.string().trim().min(1).max(HEADING_MAX),
  paragraphs: z.array(z.string().trim().min(1).max(PARAGRAPH_MAX)).min(1).max(4),
  button: z.string().trim().max(BUTTON_MAX).default(""),
  products: z.array(z.string()).max(20).default([]),
  campaigns: z.array(z.string()).max(10).default([]),
});

/** The model's choice, before code keeps only the ids its tools handed it. */
export type SuggestionDraft = z.output<typeof suggestionSchema>;

/** The model's answer read as a suggestion's draft (JSON, possibly in a code fence), or null when it is not one. */
export function parseSuggestion(text: string): SuggestionDraft | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = suggestionSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The model's subject lines read from its answer (JSON `{"subjects": [...]}`, possibly in a code fence): trimmed, within `SUBJECT_MAX`,
 * each once and different from the current one, at most `SUBJECT_CHOICES`. Empty when it is not such an answer.
 */
export function parseSubjects(text: string, current = ""): string[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = z.object({ subjects: z.array(z.string()).max(10) }).safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success) return [];
    const seen = new Set([current.trim().toLowerCase()]);
    return parsed.data.subjects
      .map((x) => x.trim().replace(/\s+/g, " "))
      .filter((x) => x.length > 0 && x.length <= SUBJECT_MAX && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
      .slice(0, SUBJECT_CHOICES);
  } catch {
    return [];
  }
}

/**
 * The rewriter's answer (JSON `{"texts": [...]}`) put back in place: one text for each of `rewritableTexts()`, in order, each within its
 * block's limit and not empty; every other block (pictures, products, offers, lines, a button's address) is kept as it was. Null when the
 * answer does not fit.
 */
export function rewrittenContent<T extends { subject: string; preview: string; blocks: BroadcastBlock[] }>(content: T, text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let texts: string[];
  try {
    const parsed = z.object({ texts: z.array(z.string()) }).safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success) return null;
    texts = parsed.data.texts.map((t) => t.trim());
  } catch {
    return null;
  }
  if (texts.length !== rewritableTexts(content).length || texts.some((t) => t.length === 0)) return null;
  const [subject, ...rest] = texts;
  if (subject.length > SUBJECT_MAX) return null;
  let i = 0;
  const limits = { heading: HEADING_MAX, paragraph: PARAGRAPH_MAX, button: BUTTON_MAX } as const;
  const blocks: BroadcastBlock[] = [];
  for (const block of content.blocks) {
    if (block.type !== "heading" && block.type !== "paragraph" && block.type !== "button") {
      blocks.push(block);
      continue;
    }
    const next = rest[i++];
    if (next.length > limits[block.type]) return null;
    blocks.push({ ...block, text: next });
  }
  return { ...content, subject, blocks };
}
