import { z } from "zod";

import { findClaims } from "./claims";
import { richTextIsEmpty, type PageContent, type PageText, type RichTextDoc } from "./page-content";
import { pageTextLabels, pageTexts } from "./page-translation";

/**
 * Translating a page with AI (D109). The page builder's "Translate with AI"
 * sends the page's texts in its main language to the store's text model and
 * puts what comes back into a language's translation, for staff to read and
 * change before they save. Only texts go to the model, never prices or
 * stock; what comes back is checked here (its shape, the text's longest
 * length, the claims filter) and a text that fails is left as it was, in the
 * main language. Pure and shared with the browser.
 */

/** Which texts to translate: the ones a language lacks, or all of them again (replacing what is there). */
export type TranslateMode = "missing" | "all";

/** One text of the page: its place, what it is, its longest length, and its words (a rich text as its runs). */
export type TranslateItem = {
  key: string;
  label: string;
  /** The longest length; 0 for rich text, which is checked on its own. */
  max: number;
  rich: boolean;
  /** A plain text is one run; a rich text's runs are those of its formatting, in order. */
  runs: string[];
};

/** What the browser asks for: the texts, and the two languages by name. */
export const translateRequest = z.object({
  from: z.string().trim().min(2).max(60),
  to: z.string().trim().min(2).max(60),
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        label: z.string().max(200),
        max: z.number().int().min(0).max(5000),
        rich: z.boolean(),
        runs: z.array(z.string().max(10_000)).min(1).max(400),
      }),
    )
    .min(1)
    .max(400),
});
export type TranslateRequest = z.infer<typeof translateRequest>;

/** The most text one request takes: a page's, with room to spare. */
export const TRANSLATE_MAX_CHARACTERS = 100_000;

export const requestSize = (items: readonly TranslateItem[]) => items.reduce((sum, item) => sum + item.runs.reduce((n, run) => n + run.length, 0), 0);

/** A text the model left as it was: which, and why. */
export type Skipped = { key: string; label: string; reason: string };

/** What came back: each translated text (a plain one as a string, a rich one as its runs), and those left alone. */
export type Translated = { done: Record<string, string | string[]>; skipped: Skipped[] };

// ---------------------------------------------------------------------------
// Rich text as runs
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function eachRun(node: unknown, visit: (run: Json) => void): void {
  if (!node || typeof node !== "object") return;
  const n = node as Json;
  if (n.type === "text" && typeof n.text === "string") visit(n);
  if (Array.isArray(n.content)) for (const child of n.content) eachRun(child, visit);
}

/** A rich text's words as the runs of its formatting, in the order they are read. */
export function richRuns(doc: RichTextDoc): string[] {
  const runs: string[] = [];
  eachRun(doc, (run) => runs.push(String(run.text)));
  return runs;
}

/** The same document with its runs replaced; null when there are not as many. */
export function withRichRuns(doc: RichTextDoc, runs: readonly string[]): RichTextDoc | null {
  if (runs.length !== richRuns(doc).length) return null;
  let i = 0;
  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    const n = node as Json;
    if (n.type === "text" && typeof n.text === "string") return { ...n, text: runs[i++] };
    return Array.isArray(n.content) ? { ...n, content: n.content.map(walk) } : n;
  };
  return walk(doc) as RichTextDoc;
}

/** A translation's run with the source's own leading and trailing spaces, which formatting often needs. */
function keepEdges(source: string, translated: string): string {
  const lead = /^\s*/.exec(source)?.[0] ?? "";
  const trail = /\s*$/.exec(source)?.[0] ?? "";
  return `${lead}${translated.trim()}${trail}`;
}

// ---------------------------------------------------------------------------
// What to translate
// ---------------------------------------------------------------------------

const isEmpty = (value: PageText) => (typeof value === "string" ? value.trim() === "" : richTextIsEmpty(value));

/**
 * The page's texts to translate into `locale`: every text with words in the
 * main language, in page order, and with `missing` only those the language
 * does not have yet.
 */
export function translationItems(content: PageContent, locale: string, mode: TranslateMode): TranslateItem[] {
  const names = pageTextLabels(content);
  const labels = (key: string) => names.get(key) ?? key;
  const have = content.translations?.[locale] ?? {};
  const items: TranslateItem[] = [];
  for (const [key, { value, max }] of pageTexts(content)) {
    if (isEmpty(value)) continue;
    if (mode === "missing" && key in have) continue;
    if (typeof value === "string") items.push({ key, label: labels(key), max, rich: false, runs: [value] });
    else items.push({ key, label: labels(key), max: 0, rich: true, runs: richRuns(value) });
  }
  return items;
}

/** The items in groups a model can answer in one reply. */
export function batchItems(items: readonly TranslateItem[], maxCharacters = 5000, maxItems = 30): TranslateItem[][] {
  const batches: TranslateItem[][] = [];
  let current: TranslateItem[] = [];
  let size = 0;
  for (const item of items) {
    const n = item.runs.reduce((sum, run) => sum + run.length, 0);
    if (current.length > 0 && (size + n > maxCharacters || current.length >= maxItems)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += n;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// ---------------------------------------------------------------------------
// The model's part
// ---------------------------------------------------------------------------

/** The messages that ask for a batch: the rules, then the texts by a short id. */
export function translationMessages(from: string, to: string, batch: readonly TranslateItem[]): { role: "system" | "user"; content: string }[] {
  const rules = [
    `You translate texts of an online store (a web page, a product or a menu) from ${from} into ${to}.`,
    "Translate faithfully and naturally, in the same tone. Do not add, remove or improve anything: no new claims, prices, discounts, promises or urgency.",
    "Keep numbers, brand and product names, web addresses and email addresses as they are.",
    "Each text says what it is (\"what\") and its longest length in characters (\"maxChars\", 0 for none); stay within it.",
    "A text given as \"runs\" is one text split where its formatting changes: answer with the same number of runs, in the same order, each translated so they read well together, and keep each run's spaces at its start and end.",
    'Answer with JSON only, one entry per id: {"t0": "the translation", "t1": ["run", "run"]}. A text given as "text" is answered as a string, one given as "runs" as an array of strings.',
  ];
  const texts = batch.map((item, i) => ({
    id: `t${i}`,
    what: item.label,
    maxChars: item.max,
    ...(item.rich ? { runs: item.runs } : { text: item.runs[0] }),
  }));
  return [
    { role: "system", content: rules.join("\n") },
    { role: "user", content: JSON.stringify(texts) },
  ];
}

/**
 * The model's answer to a batch, checked: each text by its place, in the
 * shape asked for, within its length, and with no more claims (`findClaims`)
 * than the source had. What fails is skipped, with the reason.
 */
export function readTranslations(answer: unknown, batch: readonly TranslateItem[]): Translated {
  const reply = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
  const result: Translated = { done: {}, skipped: [] };
  batch.forEach((item, i) => {
    const skip = (reason: string) => result.skipped.push({ key: item.key, label: item.label, reason });
    const value = reply[`t${i}`];
    if (value === undefined) return skip("The AI left it out.");
    const runs = item.rich ? value : [value];
    if (!Array.isArray(runs) || !runs.every((run) => typeof run === "string")) return skip("The AI did not answer in the shape asked for.");
    if (runs.length !== item.runs.length) return skip("The AI changed how the text is split.");
    const translated = (runs as string[]).map((run, n) => keepEdges(item.runs[n], run));
    if (!item.rich && translated[0].trim() === "") return skip("The AI left it empty.");
    if (!item.rich && item.max > 0 && translated[0].length > item.max) return skip(`Longer than the ${item.max} characters it can be.`);
    const claims = findClaims(translated.join(" ")).length;
    if (claims > findClaims(item.runs.join(" ")).length) return skip("It contains a claim, a price or an urgency the text did not.");
    result.done[item.key] = item.rich ? translated : translated[0];
  });
  return result;
}

/** What the translate action answers with: the texts, or why not. */
export type TranslateResult = ({ ok: true } & Translated) | { ok: false; problem: string };

/** Puts translated texts (as `readTranslations` gives them) in a language's translation, over what is there. */
export function applyTranslated(
  content: PageContent,
  translation: Record<string, PageText>,
  done: Record<string, string | string[]>,
): Record<string, PageText> {
  const next = { ...translation };
  const texts = pageTexts(content);
  for (const [key, value] of Object.entries(done)) {
    const source = texts.get(key)?.value;
    if (source === undefined) continue;
    if (typeof source === "string") {
      if (typeof value === "string") next[key] = value;
    } else if (Array.isArray(value)) {
      const doc = withRichRuns(source, value);
      if (doc) next[key] = doc;
    }
  }
  return next;
}
