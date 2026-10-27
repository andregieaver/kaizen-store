import { fold, type CategoryHit, type SearchEntry } from "./product-taxonomy";
import { UNTRUSTED_TEXT } from "./prompt-safety";

/**
 * The AI's suggestion of a product's standard category (wave 6 unit I, D327, `docs/wave-6-catalogue.md` I.5): code picks the candidates
 * from the product's own words, the model only chooses one of them by its id (or none), and a person accepts it in the editor. The model
 * never sees a price or stock, and never names a category that is not on the list: `readCategoryChoice()` keeps only a listed id.
 */

/** At most this many candidates go to the model. */
export const CANDIDATES_MAX = 25;
/** The product's words the model reads, at most. */
const DESCRIPTION_MAX = 1500;
const TITLE_MAX = 200;

/** Words that say nothing about what a product is, in the languages the taxonomy speaks. */
const STOP = new Set([
  "and", "the", "for", "with", "from", "this", "that", "your", "our", "you", "are", "its", "into", "made", "new", "set", "pcs",
  "og", "med", "til", "for", "fra", "som", "den", "det", "der", "har", "kan", "ikke", "eller", "laget", "ny", "nye",
  "och", "med", "till", "från", "som", "den", "det", "har", "kan", "inte", "eller", "gjord", "ny",
  "og", "med", "til", "fra", "som", "den", "det", "har", "kan", "ikke", "eller", "lavet", "nye",
]);

/** The words of a text worth matching against categories' names: folded, at least three letters, no stop word, once each. */
function wordsOf(text: string): string[] {
  return [...new Set(fold(text).split(" ").filter((word) => word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word)))];
}

/** A word and its stem without a plural or definite ending, so "grinders" and "kverner" still meet "grinder" and "kvern". */
function forms(word: string): string[] {
  if (word.length < 5) return [word];
  const stem = word.replace(/(ene|ies|es|er|en|ar|na|s|e)$/u, "");
  return stem.length >= 4 && stem !== word ? [word, stem] : [word];
}

/**
 * The categories most like the product's title and description, at most `limit`: a word in a category's own name counts most (a title's
 * three times a description's, a whole word more than part of one), a word elsewhere in its path a little, and a rare word far more than a
 * common one (one in two names of the taxonomy says less than one in two thousand: "electric" against "coffee grinder"). A category whose
 * own name meets none of the words is never one. Ties go to the more specific category, then the path.
 */
export function categoryCandidates(index: readonly SearchEntry[], product: { title: string; description: string }, limit = CANDIDATES_MAX): CategoryHit[] {
  const title = wordsOf(product.title).map(forms);
  const description = wordsOf(product.description.slice(0, 4000)).filter((word) => !title.some((f) => f[0] === word)).map(forms);
  const groups = [...title.map((forms) => ({ forms, weight: 3 })), ...description.map((forms) => ({ forms, weight: 1 }))];
  if (groups.length === 0) return [];
  // How rare each word is among the categories' own names.
  const rarity = groups.map(({ forms }) => {
    let seen = 0;
    for (const entry of index) if (forms.some((form) => entry.leaf.includes(form))) seen++;
    return Math.log((index.length + 1) / (seen + 1));
  });
  const scored: { entry: SearchEntry; score: number }[] = [];
  for (const entry of index) {
    const leafWords = entry.leaf.split(" ");
    let score = 0;
    let inLeaf = false;
    groups.forEach(({ forms, weight }, at) => {
      if (forms.some((form) => leafWords.includes(form))) {
        score += weight * rarity[at];
        inLeaf = true;
      } else if (forms.some((form) => entry.leaf.includes(form))) {
        score += weight * rarity[at] * 0.7;
        inLeaf = true;
      } else if (forms.some((form) => entry.folded.includes(form))) score += weight * rarity[at] * 0.2;
    });
    if (inLeaf) scored.push({ entry, score: score + entry.depth * 0.01 });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));
  return scored.slice(0, limit).map(({ entry }) => ({ id: entry.id, name: entry.name, path: entry.path }));
}

/** The messages asking the model to choose: the product's own words as data, the candidates by id and path, an answer of one id or none. */
export function categoryMessages(product: { title: string; description: string }, candidates: readonly CategoryHit[]) {
  const system = [
    "You choose the one category of a product taxonomy that best says what a product is, from a list you are given.",
    "Answer with JSON only: {\"category\": \"<id>\"} with an id from the list exactly as written, or {\"category\": null} when none of them is what the product is.",
    "Choose the most specific category that is still true of the product. Never make up an id or a category.",
    UNTRUSTED_TEXT,
  ].join("\n");
  const user = [
    "The product, as its store wrote it:",
    JSON.stringify({ title: product.title.slice(0, TITLE_MAX), description: product.description.slice(0, DESCRIPTION_MAX) }),
    "",
    "The categories to choose from (id: path):",
    ...candidates.map((c) => `${c.id}: ${c.path}`),
  ].join("\n");
  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/** The model's choice, kept only when it is one of the candidates: an id, or null for none or anything else. */
export function readCategoryChoice(answer: unknown, candidates: readonly CategoryHit[]): CategoryHit | null {
  if (!answer || typeof answer !== "object" || !("category" in answer)) return null;
  const id = (answer as { category: unknown }).category;
  if (typeof id !== "string") return null;
  return candidates.find((c) => c.id === id.trim()) ?? null;
}

/** What the editor's Category card gets when it asks for a suggestion: one category, none, or why there is none. */
export type CategorySuggestResult = { ok: true; suggestion: CategoryHit | null } | { ok: false; problem: string };
/** The editor's suggestion action, bound to the product's words as they are in the editor. */
export type SuggestCategory = () => Promise<CategorySuggestResult>;
