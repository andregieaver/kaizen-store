/**
 * Keyword search's pure parts (Phase 2, S1): tidying what a shopper typed,
 * and the type-ahead query built from it. Tested without a database.
 */

/** Longest query kept; anything longer is cut. */
export const MAX_QUERY = 100;

/** What was typed, tidied: no control characters, single spaces, lower case, at most `MAX_QUERY` characters. */
export function normalizeQuery(query: string): string {
  return query
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase()
    .slice(0, MAX_QUERY)
    .trim();
}

/**
 * A text-search query matching words that start with each word typed
 * (`kera kop` → `kera:* & kop:*`), for type-ahead. Only letters and digits
 * reach it, so nothing typed can change its meaning; null when nothing is left.
 */
export function prefixQuery(query: string): string | null {
  const words = normalizeQuery(query).match(/[\p{L}\p{N}]+/gu)?.slice(0, 6) ?? [];
  return words.length === 0 ? null : words.map((word) => `${word}:*`).join(" & ");
}

/**
 * Search by meaning (S2, D74): merges ranked lists (keyword, meaning) by
 * reciprocal rank fusion: each list gives an item 1 / (k + rank), and items
 * are ordered by their sum. Ranks, not scores, so lists scored on different
 * scales combine; k damps the difference between the first few places.
 * Ties keep the order items were first seen, keyword first.
 */
export function reciprocalRankFusion(lists: string[][], k = 60): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1)));
  }
  // Map keeps insertion order and sort is stable, so ties stay in first-seen order.
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Longest text embedded for a product: its title and categories come first, so a long description is what gets cut. */
export const MAX_EMBEDDED = 4000;

/** What is embedded for a product translation: its title, its categories and tags, and its description. */
export function embeddingDocument(title: string, terms: string, description: string): string {
  return [title.trim(), terms.trim(), description.trim()].filter(Boolean).join("\n").slice(0, MAX_EMBEDDED);
}
