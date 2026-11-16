import { z } from "zod";

/**
 * Contracts for deals (D695, `docs/contracts.md`), pure: what a template's or a draft's block may be, the closed list of fields a block may
 * name, and the contract filled in from the facts the server gathered (`fillContract()`), which is what is frozen when it is sent. Text is
 * text: a field's value and a block's words are never HTML, and the views escape them. A field that has no value is reported, never left as
 * `{key}` in what is sent. Nothing here knows a database.
 */

export const CONTRACT_TEXT_MAX = 20_000;
export const CONTRACT_HEADING_MAX = 200;
export const CONTRACT_BLOCKS_MAX = 200;

/** The fields a template may name, as `{key}` in its words. Their values come from the deal, its person and company, the store and today. */
export const CONTRACT_FIELDS = [
  "customer.name",
  "customer.email",
  "customer.phone",
  "customer.address",
  "company.name",
  "company.org_number",
  "company.address",
  "store.name",
  "store.org_number",
  "store.address",
  "store.email",
  "deal.title",
  "deal.owner",
  "deal.value",
  "contract.title",
  "contract.date",
  "contract.expires",
] as const;
export type ContractField = (typeof CONTRACT_FIELDS)[number];
const isField = (key: string): key is ContractField => (CONTRACT_FIELDS as readonly string[]).includes(key);

/** `{customer.name}`: a field's key in braces, letters, dots and underscores. */
const FIELD = /\{([a-z_]+\.[a-z_]+)\}/g;

const words = (max: number) => z.string().max(max);
const clauseId = z.string().regex(/^[a-z0-9_-]{1,40}$/);

const heading = z.object({ type: z.literal("heading"), text: words(CONTRACT_HEADING_MAX) });
const paragraph = z.object({ type: z.literal("paragraph"), text: words(CONTRACT_TEXT_MAX) });
/** A clause Lisa may leave out of a contract (`optional`), in a draft `included` or not. */
const clause = z.object({
  type: z.literal("clause"),
  id: clauseId,
  title: words(CONTRACT_HEADING_MAX),
  text: words(CONTRACT_TEXT_MAX),
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

export type BlocksProblem = { kind: "shape"; at: number | null } | { kind: "unknown_field"; key: string } | { kind: "clause_twice"; id: string };

/** Blocks as stored or typed, checked: their shape, fields only from the list, each clause's id once. */
export function parseBlocks(raw: unknown): { ok: true; blocks: ContractBlock[] } | { ok: false; problems: BlocksProblem[] } {
  const parsed = contractBlocks.safeParse(raw);
  if (!parsed.success) {
    const at = parsed.error.issues[0]?.path[0];
    return { ok: false, problems: [{ kind: "shape", at: typeof at === "number" ? at : null }] };
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

const textsOf = (block: ContractBlock): string[] =>
  block.type === "heading" || block.type === "paragraph" ? [block.text] : block.type === "clause" ? [block.title, block.text] : [];

/** The `{key}`s the blocks name, in their order, once each; with `all`, keys that are not fields too (else only known fields). */
export function fieldsIn(blocks: readonly ContractBlock[], options: { all?: boolean } = {}): string[] {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.type === "clause" && !block.included) continue;
    for (const text of textsOf(block)) for (const match of text.matchAll(FIELD)) seen.add(match[1]);
  }
  return [...seen].filter((key) => options.all || isField(key));
}

/** One of the linked quote's lines, formatted by the server (amounts are worked out and written in code, never by a model). */
export type QuoteLineFact = { name: string; quantity: number; unitPrice: string; total: string };

/** What the server gathered: a value per field it has (absent or blank is none), the quote's lines and total if a quote is linked. */
export type ContractFacts = {
  values: Partial<Record<ContractField, string | null>>;
  quote: { lines: QuoteLineFact[]; total: string } | null;
};

/** A block as it was sent: its words with every field filled in. */
export type FilledBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "clause"; id: string; title: string; text: string }
  | { type: "quote_lines"; lines: QuoteLineFact[]; total: string }
  | { type: "signatures" };

/** What is frozen when a contract is sent (`contracts.snapshot`). */
export type ContractSnapshot = { version: 1; title: string; language: string; blocks: FilledBlock[] };

export type FillProblem = { kind: "missing_field"; key: ContractField } | { kind: "no_quote" } | { kind: "no_signatures" } | { kind: "empty" };

const fill = (text: string, values: ContractFacts["values"], missing: Set<ContractField>): string =>
  text.replace(FIELD, (whole, key: string) => {
    if (!isField(key)) return whole;
    const value = values[key]?.trim();
    if (!value) {
      missing.add(key);
      return whole;
    }
    return value;
  });

/**
 * The contract filled in: optional clauses left out drop away, each field takes its value, the quote's block takes the quote's lines. It
 * is ready to send only with no problem: every field named has a value, a quote block has a quote, and there is a place to sign.
 */
export function fillContract(
  input: { title: string; language: string; blocks: readonly ContractBlock[] },
  facts: ContractFacts,
): { ok: true; snapshot: ContractSnapshot } | { ok: false; problems: FillProblem[]; snapshot: ContractSnapshot } {
  const missing = new Set<ContractField>();
  const problems: FillProblem[] = [];
  const blocks: FilledBlock[] = [];
  for (const block of input.blocks) {
    switch (block.type) {
      case "heading":
      case "paragraph":
        blocks.push({ type: block.type, text: fill(block.text, facts.values, missing) });
        break;
      case "clause":
        if (block.included || !block.optional) blocks.push({ type: "clause", id: block.id, title: fill(block.title, facts.values, missing), text: fill(block.text, facts.values, missing) });
        break;
      case "quote_lines":
        if (facts.quote) blocks.push({ type: "quote_lines", lines: facts.quote.lines, total: facts.quote.total });
        else if (!problems.some((p) => p.kind === "no_quote")) problems.push({ kind: "no_quote" });
        break;
      case "signatures":
        blocks.push({ type: "signatures" });
        break;
    }
  }
  for (const key of missing) problems.push({ kind: "missing_field", key });
  if (!blocks.some((b) => b.type !== "signatures")) problems.push({ kind: "empty" });
  if (!blocks.some((b) => b.type === "signatures")) problems.push({ kind: "no_signatures" });
  const snapshot: ContractSnapshot = { version: 1, title: input.title, language: input.language, blocks };
  return problems.length ? { ok: false, problems, snapshot } : { ok: true, snapshot };
}

/** A draft's blocks from its template's: each optional clause starts included, as the template wrote it. */
export const draftBlocks = (template: readonly ContractBlock[]): ContractBlock[] =>
  template.map((block) => (block.type === "clause" ? { ...block, included: true } : { ...block }));
