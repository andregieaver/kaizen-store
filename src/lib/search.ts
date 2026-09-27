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
