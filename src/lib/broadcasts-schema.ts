import { z } from "zod";

import { BROADCAST_AUDIENCES } from "./broadcast-status";
import { SOCIAL_NETWORKS, type SocialNetwork } from "./social-links";
import { TEST_HOURS, TEST_SHARE } from "./broadcast-test-sizes";
import {
  ADDRESS_MAX,
  ALT_MAX,
  BLOCKS_MAX,
  BUTTON_MAX,
  HEADING_MAX,
  PARAGRAPH_MAX,
  PREVIEW_MAX,
  SUBJECT_CHOICES,
  SOCIAL_MAX,
  SUBJECT_MAX,
  CELL_TEXT_MAX,
  CELLS_MAX,
  isBroadcastAddress,
  rewritableTexts,
} from "./broadcasts";

/**
 * The schemas of broadcasts.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; broadcasts.ts imports it as a type alone.
 */

const address = z.string().trim().refine(isBroadcastAddress, "Write a full address starting with https://, or a path of your store such as /products.");
const words = (max: number, what: string) => z.string().trim().min(1, `${what} is empty.`).max(max, `${what} is longer than ${max} characters.`);

/**
 * A cell of a columns block (M4.1): any of a picture (from the store's media library, as a picture block), a heading, words and a button;
 * the button's words and address go together, and a cell has something in it.
 */
const cellSchema = z
  .object({
    image: z.string().trim().url("Choose a picture.").max(ADDRESS_MAX).nullable().default(null),
    alt: z.string().trim().max(ALT_MAX, `A picture's description is longer than ${ALT_MAX} characters.`).default(""),
    heading: z.string().trim().max(HEADING_MAX, `A heading is longer than ${HEADING_MAX} characters.`).default(""),
    text: z.string().trim().max(CELL_TEXT_MAX, `A column's words are longer than ${CELL_TEXT_MAX} characters.`).default(""),
    buttonText: z.string().trim().max(BUTTON_MAX, `A button's words are longer than ${BUTTON_MAX} characters.`).default(""),
    buttonUrl: z.union([z.literal(""), address]).default(""),
  })
  .refine((c) => Boolean(c.image || c.heading || c.text || c.buttonText), "A column is empty.")
  .refine((c) => Boolean(c.buttonText) === Boolean(c.buttonUrl), "A column's button needs both its words and its address.");
export type BroadcastCell = z.infer<typeof cellSchema>;

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
  // The store's social profiles (email plan M4.1): up to eight networks with their addresses, drawn as one quiet row of links.
  z.object({
    type: z.literal("social"),
    links: z
      .array(z.object({ network: z.enum(Object.keys(SOCIAL_NETWORKS) as [SocialNetwork, ...SocialNetwork[]]), url: z.string().trim().min(1).max(ADDRESS_MAX) }))
      .min(1, "Add at least one profile.")
      .max(SOCIAL_MAX, `At most ${SOCIAL_MAX} profiles.`),
  }),
  // Two or three cells side by side (M4.1), stacked on a phone.
  z.object({ type: z.literal("columns"), cells: z.array(cellSchema).min(2, "Columns need at least two.").max(CELLS_MAX, `At most ${CELLS_MAX} columns.`) }),
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

/**
 * A broadcast's split test (email plan M2.5, D868): version B's subject and preview per language (its words and links are A's), the share
 * of the audience tested and the hours before the call (`src/lib/broadcast-tests.ts`).
 */
export const broadcastTestSchema = z.object({
  b: z.record(
    z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    z.object({
      subject: z.string().trim().min(1, "Version B's subject is empty.").max(SUBJECT_MAX, `A subject is longer than ${SUBJECT_MAX} characters.`),
      preview: z.string().trim().max(PREVIEW_MAX, `The preview line is longer than ${PREVIEW_MAX} characters.`).default(""),
    }),
  ),
  share: z.number().int().min(TEST_SHARE.min).max(TEST_SHARE.max).default(TEST_SHARE.start),
  hours: z.number().int().min(TEST_HOURS.min).max(TEST_HOURS.max).default(TEST_HOURS.start),
});
export type BroadcastTest = z.infer<typeof broadcastTestSchema>;

export const broadcastInput = z
  .object({
    title: z.string().trim().min(1, "Give it a name.").max(80, "The name is longer than 80 characters."),
    audience: z.enum(BROADCAST_AUDIENCES),
    segmentId: z.uuid().nullable(),
    content: broadcastContentSchema,
    test: broadcastTestSchema.nullable().optional(),
    /** Each reader at their own hour (M4.4); not with a split test, whose versions go out together. */
    bestTime: z.boolean().optional(),
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
