import { z } from "zod";

import { SYNONYM_KINDS, type SynonymInput, type SynonymProblem, WORDS_MAX, cleanWord } from "./search-synonyms";

/**
 * The schemas of search-synonyms.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; search-synonyms.ts imports it as a type alone.
 */

/** The shape a group arrives in, before its words are checked (`readSynonym()`). */
export const synonymInput = z.object({
  id: z.uuid().nullable().default(null),
  locale: z.string().trim().min(2).max(20),
  kind: z.enum(SYNONYM_KINDS),
  words: z.array(z.string().max(200)).max(WORDS_MAX * 2),
  means: z.array(z.string().max(200)).max(WORDS_MAX * 2).default([]),
});

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
