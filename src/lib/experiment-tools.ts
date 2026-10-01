import { findPart } from "./experiment-parts";
import { textToDoc } from "./field-binding";
import { blockText, cleanRichText, richTextIsEmpty, type PageBlock, type PageContent, type PageRow } from "./page-content";

/**
 * What the AI manager's A/B test tools (D148, phase 4) do that needs no database: the blocks of a page it may offer to change,
 * and the change itself. The assistant writes the words; code checks them (the claims filter, the lengths), puts them in the
 * version's block and leaves everything else alone. Pure, so the browser-free tests hold it.
 */

export const CHANGEABLE = ["heading", "button", "richText"] as const;
type Changeable = (typeof CHANGEABLE)[number];
const changeable = (type: string): type is Changeable => (CHANGEABLE as readonly string[]).includes(type);

export const HEADING_MAX = 300;
export const BUTTON_MAX = 100;
export const TEXT_MAX = 2000;

export type TestChange = { block: string; text: string };

/** A block the assistant can be offered to change, with what it says now. */
export type OfferedBlock = { id: string; kind: Changeable; text: string };

const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** The headings, buttons and texts of a page in order, up to `max`: what a test of its words could change. */
export function offeredBlocks(content: Pick<PageContent, "rows">, max = 12): OfferedBlock[] {
  const out: OfferedBlock[] = [];
  for (const row of content.rows) {
    for (const column of row.columns) {
      for (const block of column.blocks) {
        if (!changeable(block.type)) continue;
        const text = block.type === "button" ? block.label : blockText(block);
        out.push({ id: block.id, kind: block.type, text: oneLine(text, 160) });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

const mapBlocks = (rows: PageRow[], change: (block: PageBlock) => PageBlock): PageRow[] =>
  rows.map((row) => ({ ...row, columns: row.columns.map((column) => ({ ...column, blocks: column.blocks.map(change) })) }));

export type ApplyResult = { ok: true; content: PageContent; texts: string[] } | { ok: false; problem: string };

/**
 * A page with the given words put into its headings, buttons and texts. Each block must be one of those kinds on the page,
 * once; a heading and a button take one line within their lengths, a text any number of paragraphs (plain, never markup).
 * `texts` are the words put in, for the claims filter.
 */
export function applyChanges(content: PageContent, changes: readonly TestChange[]): ApplyResult {
  if (changes.length === 0) return { ok: true, content, texts: [] };
  const seen = new Set<string>();
  const byId = new Map<string, string>();
  for (const change of changes) {
    if (seen.has(change.block)) return { ok: false, problem: `Block ${change.block} is changed twice: give each block's new words once.` };
    seen.add(change.block);
    const found = findPart(content.rows, change.block);
    if (!found || found.kind !== "block") return { ok: false, problem: `The page has no block ${change.block}. suggest_experiments lists the blocks whose words can be changed.` };
    const block = found.node as PageBlock;
    if (!changeable(block.type)) return { ok: false, problem: `The words of a ${block.type} block cannot be changed here: only headings, buttons and texts.` };
    const text = change.text.trim();
    if (text === "") return { ok: false, problem: `Block ${change.block} needs words.` };
    if (block.type === "heading" && (text.length > HEADING_MAX || /\n/.test(text))) return { ok: false, problem: `A heading is one line of at most ${HEADING_MAX} characters.` };
    if (block.type === "button" && (text.length > BUTTON_MAX || /\n/.test(text))) return { ok: false, problem: `A button's text is one line of at most ${BUTTON_MAX} characters.` };
    if (block.type === "richText" && text.length > TEXT_MAX) return { ok: false, problem: `A text is at most ${TEXT_MAX} characters.` };
    byId.set(change.block, text);
  }
  let problem: string | null = null;
  const rows = mapBlocks(content.rows, (block) => {
    const text = byId.get(block.id);
    if (text === undefined) return block;
    if (block.type === "heading") return { ...block, text };
    if (block.type === "button") return { ...block, label: text };
    if (block.type === "richText") {
      const cleaned = cleanRichText(textToDoc(text));
      if (!cleaned.ok || richTextIsEmpty(cleaned.doc)) {
        problem = `Block ${block.id}'s text could not be used.`;
        return block;
      }
      return { ...block, doc: cleaned.doc };
    }
    return block;
  });
  return problem ? { ok: false, problem } : { ok: true, content: { ...content, rows }, texts: [...byId.values()] };
}

/** A single changed block makes a test of that block (a part test); several make a test of the whole page. */
export const partOf = (changes: readonly TestChange[]): { kind: "block"; id: string } | null => (changes.length === 1 ? { kind: "block", id: changes[0].block } : null);
