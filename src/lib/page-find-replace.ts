import type { BlockNode, InlineNode, PageContent, PageText, RichTextDoc } from "./page-content";
import { mapTexts, pageTextLabels } from "./page-translation";

/**
 * Find and replace in the page builder (D307): words or phrases found in every text a page shows (the texts `mapTexts()` walks, so
 * every text a translator sees: headings, rich text, buttons, captions, alt texts, items, the title and search texts) and replaced in
 * the ones chosen, in one step the editor's Undo takes back. Only words are touched: inline markup's tags (`<strong>`, a span's class)
 * and rich text's marks stay as they are, so a match is looked for within one run of words (a phrase half bold is not found). A
 * replacement that would make a text longer than it may be leaves that text as it is, and says so.
 */

export type FindOptions = { matchCase?: boolean; wholeWords?: boolean };

/** One text of the page with what was found in it. */
export type FoundText = {
  key: string;
  label: string;
  /** How many times the words are in it. */
  count: number;
  /** The text around the first match, to show which it is. */
  before: string;
  match: string;
  after: string;
};

/** At most this many characters looked for or put in. */
export const FIND_MAX = 200;
const AROUND = 30;

/** The words as a pattern: literal, case as asked, and whole words only when asked (letters and digits of any language). */
export function findPattern(query: string, options: FindOptions = {}): RegExp | null {
  if (query === "" || query.length > FIND_MAX) return null;
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = options.wholeWords ? `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])` : literal;
  return new RegExp(source, options.matchCase ? "gu" : "giu");
}

/** A plain text's runs of words, with inline markup's tags apart (never searched). */
const runs = (text: string) => text.split(/(<[^<>]*>)/);
const isTag = (part: string) => part.startsWith("<") && part.endsWith(">");

const replaceRuns = (text: string, pattern: RegExp, put: string) =>
  runs(text)
    .map((part) => (isTag(part) ? part : part.replace(pattern, () => put)))
    .join("");

// A text node replaced by nothing goes: rich text holds no empty text nodes.
const mapInline = (nodes: InlineNode[] | undefined, fn: (text: string) => string): InlineNode[] | undefined =>
  nodes
    ?.map((node) => (node.type === "text" ? { ...node, text: fn(node.text) } : node))
    .filter((node) => node.type !== "text" || node.text !== "");

function mapDocText(doc: RichTextDoc, fn: (text: string) => string): RichTextDoc {
  const block = (node: BlockNode): BlockNode => {
    const content = (node as { content?: unknown[] }).content;
    if (!content) return node;
    if (node.type === "paragraph" || node.type === "heading") return { ...node, content: mapInline(node.content, fn) } as BlockNode;
    return { ...node, content: (content as BlockNode[]).map(block) } as BlockNode;
  };
  return { ...doc, content: doc.content.map(block) };
}

/** A text's runs of words, each searched on its own. */
function wordsOf(value: PageText): string[] {
  if (typeof value === "string") return runs(value).filter((part) => !isTag(part));
  const found: string[] = [];
  mapDocText(value, (text) => {
    found.push(text);
    return text;
  });
  return found;
}

/** Where the words are on the page, text by text, in the page's order. */
export function findInPage(content: PageContent, query: string, options: FindOptions = {}): FoundText[] {
  const pattern = findPattern(query, options);
  if (!pattern) return [];
  const labels = pageTextLabels(content);
  const found: FoundText[] = [];
  mapTexts(content, (key, value) => {
    let count = 0;
    let first: FoundText | null = null;
    for (const run of wordsOf(value)) {
      for (const match of run.matchAll(pattern)) {
        count += 1;
        if (!first) {
          const at = match.index ?? 0;
          const start = Math.max(0, at - AROUND);
          const end = Math.min(run.length, at + match[0].length + AROUND);
          first = {
            key,
            label: labels.get(key) ?? key,
            count: 0,
            before: `${start > 0 ? "…" : ""}${run.slice(start, at)}`,
            match: match[0],
            after: `${run.slice(at + match[0].length, end)}${end < run.length ? "…" : ""}`,
          };
        }
      }
    }
    if (first) found.push({ ...first, count });
    return value;
  });
  return found;
}

/**
 * The page with the words replaced in the texts named by `only` (all when it is not given), and what came of it: how many were
 * replaced, and which texts were left because the result would be too long.
 */
export function replaceInPage(
  content: PageContent,
  query: string,
  replacement: string,
  options: FindOptions = {},
  only?: ReadonlySet<string>,
): { content: PageContent; replaced: number; tooLong: string[] } {
  const pattern = findPattern(query, options);
  if (!pattern || replacement.length > FIND_MAX) return { content, replaced: 0, tooLong: [] };
  let replaced = 0;
  const tooLong: string[] = [];
  const next = mapTexts(content, (key, value, max) => {
    if (only && !only.has(key)) return value;
    const count = wordsOf(value).reduce((sum, run) => sum + [...run.matchAll(pattern)].length, 0);
    if (count === 0) return value;
    if (typeof value === "string") {
      const result = replaceRuns(value, pattern, replacement);
      if (max > 0 && result.length > max) {
        tooLong.push(key);
        return value;
      }
      replaced += count;
      return result;
    }
    replaced += count;
    return mapDocText(value, (text) => text.replace(pattern, () => replacement));
  });
  return { content: replaced > 0 ? next : content, replaced, tooLong };
}
