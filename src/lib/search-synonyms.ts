import { z } from "zod";

import { normalizeQuery } from "./search";

/**
 * A store's search synonyms (wave 6 unit F1, D324, `docs/wave-6-catalogue.md` F.1), the parts that need no database: the editor's check
 * (`synonymInput`, shared with the browser) and the expansion of a search (`expandQuery()`). A group is per language: `both` (every word means
 * the others) or `one_way` (each of `words` also finds `means`, never the other way).
 */

export const SYNONYM_KINDS = ["both", "one_way"] as const;
export type SynonymKind = (typeof SYNONYM_KINDS)[number];

/** The most words on either side of a group. */
export const WORDS_MAX = 20;
/** The longest word or phrase. */
export const WORD_MAX = 60;
/** The most groups a store keeps. */
export const SYNONYMS_MAX = 500;
/** The most alternatives a search is expanded to, besides itself. */
export const MAX_ALTERNATIVES = 8;

export type SynonymGroup = { kind: SynonymKind; words: string[]; means: string[] };

/** Letters, digits, spaces, hyphens and apostrophes only: nothing that changes how a search query is read. */
const WORD_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u;

/** A word or phrase as a group keeps it (`normalizeQuery()`'s form), or null when it is empty, too long or holds anything else. */
export function cleanWord(raw: string): string | null {
  const word = normalizeQuery(raw);
  if (word === "" || word.length > WORD_MAX || !WORD_SHAPE.test(word)) return null;
  return word;
}

/** The words typed in one field: separated by commas, semicolons, `=` or new lines, empty ones left out. */
export function splitWords(text: string): string[] {
  return text
    .split(/[,;=\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The shape a group arrives in, before its words are checked (`readSynonym()`). */
export const synonymInput = z.object({
  id: z.uuid().nullable().default(null),
  locale: z.string().trim().min(2).max(20),
  kind: z.enum(SYNONYM_KINDS),
  words: z.array(z.string().max(200)).max(WORDS_MAX * 2),
  means: z.array(z.string().max(200)).max(WORDS_MAX * 2).default([]),
});

export type SynonymInput = { id: string | null; locale: string; kind: SynonymKind; words: string[]; means: string[] };

/** What is wrong with a group, for the admin's words (`search.synonyms.problems`). */
export type SynonymProblem =
  | { code: "shape" }
  | { code: "word"; word: string }
  | { code: "both_count" }
  | { code: "one_way_words" }
  | { code: "one_way_means" }
  | { code: "self" };

/**
 * A group as typed, checked: words kept as a search reads them, once each, a two-way group of 2 to `WORDS_MAX`, a one-way group of 1 to
 * `WORDS_MAX` on each side and no word finding itself. A two-way group keeps no `means`.
 */
export function readSynonym(raw: unknown): { ok: true; value: SynonymInput } | { ok: false; problems: SynonymProblem[] } {
  const parsed = synonymInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [{ code: "shape" }] };
  const input = parsed.data;
  const problems: SynonymProblem[] = [];
  const clean = (list: string[]) => {
    const out: string[] = [];
    for (const typed of list) {
      if (typed.trim() === "") continue;
      const word = cleanWord(typed);
      if (word === null) problems.push({ code: "word", word: typed.trim().slice(0, 40) });
      else if (!out.includes(word)) out.push(word);
    }
    return out;
  };
  const words = clean(input.words);
  const means = input.kind === "one_way" ? clean(input.means) : [];
  if (input.kind === "both" && (words.length < 2 || words.length > WORDS_MAX)) problems.push({ code: "both_count" });
  if (input.kind === "one_way") {
    if (words.length < 1 || words.length > WORDS_MAX) problems.push({ code: "one_way_words" });
    if (means.length < 1 || means.length > WORDS_MAX) problems.push({ code: "one_way_means" });
    if (words.some((word) => means.includes(word))) problems.push({ code: "self" });
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { id: input.id, locale: input.locale, kind: input.kind, words, means } };
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `text` holds `word` as whole words (a phrase's words in order, nothing glued on either side). */
function wholeWords(word: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}(?![\\p{L}\\p{N}])`, "gu");
}

/** Whether a search (as `normalizeQuery()` leaves it) holds `phrase` as whole words: also a search rule's `contains` (F.2). */
export function holdsWords(query: string, phrase: string): boolean {
  return phrase !== "" && wholeWords(phrase).test(query);
}

/** What each word of a group finds besides itself: the others of a `both` group, `means` from each of a `one_way` group's `words`. */
function pairsOf(group: SynonymGroup): [string, string[]][] {
  if (group.kind === "both") return group.words.map((word) => [word, group.words.filter((other) => other !== word)]);
  return group.words.map((word) => [word, group.means]);
}

/**
 * A search's alternatives: for each group with a word the search holds as whole words, the search with that word put in place of each word it
 * finds. Longer words are tried first ("t-shirt" before "shirt"), each alternative changes one word, the search itself is never among them, and
 * there are at most `MAX_ALTERNATIVES`.
 */
export function expandQuery(text: string, groups: readonly SynonymGroup[]): string[] {
  const query = normalizeQuery(text);
  if (!query) return [];
  const pairs = groups.flatMap(pairsOf).sort((a, b) => b[0].length - a[0].length);
  const out: string[] = [];
  for (const [word, finds] of pairs) {
    const pattern = wholeWords(word);
    if (!pattern.test(query)) continue;
    for (const other of finds) {
      const alternative = query.replace(wholeWords(word), other);
      if (alternative !== query && !out.includes(alternative)) out.push(alternative);
      if (out.length >= MAX_ALTERNATIVES) return out;
    }
  }
  return out;
}

/** A group as one line for the admin: "sofa = couch = settee", or "jumper, pullover → sweater". */
export function synonymLine(group: SynonymGroup): string {
  return group.kind === "both" ? group.words.join(" = ") : `${group.words.join(", ")} → ${group.means.join(", ")}`;
}
