import { z } from "zod";

import { contractDoc, contractDocText } from "./contract-rich";
import type { RichTextDoc } from "./rich-text-doc";
import { type BlocksProblem, CONTRACT_BLOCKS_MAX, CONTRACT_HEADING_MAX, CONTRACT_TEXT_MAX, fieldsIn, isField } from "./contract-fields";

/**
 * The schemas of contract-fields.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; contract-fields.ts imports it as a type alone.
 */

const words = (max: number) => z.string().max(max);
const clauseId = z.string().regex(/^[a-z0-9_-]{1,40}$/);
/** A block's words formatted, cut to what a contract takes (`contractDoc()`). */
const formatted = z
  .custom<RichTextDoc>((value) => contractDoc(value).ok)
  .transform((value) => {
    const cleaned = contractDoc(value);
    return cleaned.ok ? cleaned.doc : { type: "doc" as const, content: [] };
  });

const heading = z.object({ type: z.literal("heading"), text: words(CONTRACT_HEADING_MAX) });
const paragraph = z.object({ type: z.literal("paragraph"), text: words(CONTRACT_TEXT_MAX), doc: formatted.optional() });
/** A clause Lisa may leave out of a contract (`optional`), in a draft `included` or not. */
const clause = z.object({
  type: z.literal("clause"),
  id: clauseId,
  title: words(CONTRACT_HEADING_MAX),
  text: words(CONTRACT_TEXT_MAX),
  doc: formatted.optional(),
  optional: z.boolean().default(false),
  included: z.boolean().default(true),
});
/** The linked quote's lines, as a table: fields only, the quote itself is never what is signed (the owner, 16 November 2026). */
const quoteLines = z.object({ type: z.literal("quote_lines") });
/** Where the signatures go: one box per signer, filled in when they sign. */
const signatures = z.object({ type: z.literal("signatures") });

export const contractBlock = z.discriminatedUnion("type", [heading, paragraph, clause, quoteLines, signatures]);
export type ContractBlock = z.infer<typeof contractBlock>;
export const contractBlocks = z.array(contractBlock).max(CONTRACT_BLOCKS_MAX);

/** Blocks as stored or typed, checked: their shape, fields only from the list, each clause's id once. */
export function parseBlocks(raw: unknown): { ok: true; blocks: ContractBlock[] } | { ok: false; problems: BlocksProblem[] } {
  const parsed = contractBlocks.safeParse(raw);
  if (!parsed.success) {
    const at = parsed.error.issues[0]?.path[0];
    return { ok: false, problems: [{ kind: "shape", at: typeof at === "number" ? at : null }] };
  }
  // A formatted block's text is its document's words, whatever was sent beside it.
  for (const [at, block] of parsed.data.entries()) {
    if ((block.type !== "paragraph" && block.type !== "clause") || !block.doc) continue;
    block.text = contractDocText(block.doc);
    if (block.text.length > CONTRACT_TEXT_MAX) return { ok: false, problems: [{ kind: "shape", at }] };
  }
  const problems: BlocksProblem[] = [];
  const unknown = new Set<string>();
  for (const key of fieldsIn(parsed.data, { all: true })) if (!isField(key)) unknown.add(key);
  for (const key of unknown) problems.push({ kind: "unknown_field", key });
  const ids = new Set<string>();
  for (const block of parsed.data) {
    if (block.type !== "clause") continue;
    if (ids.has(block.id)) problems.push({ kind: "clause_twice", id: block.id });
    ids.add(block.id);
  }
  return problems.length ? { ok: false, problems } : { ok: true, blocks: parsed.data };
}
