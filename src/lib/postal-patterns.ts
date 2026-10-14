import { cleanPostalCode } from "./postal-code";
import { PATTERN_CHARS_MAX, PATTERN_LENGTH_MAX, PATTERNS_MAX } from "./shipping-limits";

/**
 * Postal-code patterns (D237, `docs/wave-3-shipping-methods.md` 2.1 and 4.1): how a zone or a local delivery area says which postal codes it covers.
 * A pattern is an exact code (`0150`) or a prefix ending in `*` (`01*`), written as the country writes its codes (`cleanPostalCode()`); a numeric
 * range is entered as prefixes. A code's zone is the zone holding the most specific pattern that matches it: an exact code beats any prefix, a longer
 * prefix a shorter one. The database holds the same rules (`commerce.postal_patterns_problem()`, `shipping_zones_rules()`). Pure, no zod: the checkout
 * (a pay route) reads it.
 */

/** The full length of a country's codes when it has one: a prefix may be at most that long. */
const CODE_LENGTH: Record<string, number> = { NO: 4, DK: 4, SE: 5, FI: 5, DE: 5 };

/** A pattern as typed, written as the country writes its codes, or null when it is not one. */
export function cleanPostalPattern(country: string, typed: string): string | null {
  const text = typed.replace(/\s+/g, "").toUpperCase();
  if (!text.endsWith("*")) return cleanPostalCode(country, text);
  const prefix = text.slice(0, -1);
  if (!prefix || prefix.includes("*")) return null;
  const length = CODE_LENGTH[country.toUpperCase()];
  if (length !== undefined) return new RegExp(`^\\d{1,${length}}$`).test(prefix) ? `${prefix}*` : null;
  return new RegExp(`^[A-Z0-9-]{1,${PATTERN_LENGTH_MAX}}$`).test(prefix) ? `${prefix}*` : null;
}

/**
 * A list of patterns as the owner types it (comma, space or line separated), cleaned and without repeats, in the order typed, and the entries
 * that are not patterns. A space inside a Swedish code (`114 55`) separates two entries, so such codes are typed without it or with a `*`.
 */
export function parsePatternList(country: string, typed: string): { patterns: string[]; invalid: string[] } {
  const patterns: string[] = [];
  const invalid: string[] = [];
  for (const entry of typed.split(/[\s,;]+/).filter(Boolean)) {
    const pattern = cleanPostalPattern(country, entry);
    if (pattern === null) invalid.push(entry);
    else if (!patterns.includes(pattern)) patterns.push(pattern);
  }
  return { patterns, invalid };
}

/** What is wrong with a list of patterns, as the database says it (`postal_patterns.*`), or null. */
export function patternListProblem(patterns: readonly string[]): "empty" | "too_many" | "malformed" | "duplicate" | "too_long" | null {
  if (patterns.length === 0) return "empty";
  if (patterns.length > PATTERNS_MAX) return "too_many";
  if (patterns.some((p) => !/^[A-Z0-9-]{1,10}\*?$/.test(p))) return "malformed";
  if (new Set(patterns).size !== patterns.length) return "duplicate";
  if (patterns.reduce((sum, p) => sum + p.length, 0) > PATTERN_CHARS_MAX) return "too_long";
  return null;
}

const isPrefix = (pattern: string) => pattern.endsWith("*");

/** Whether a pattern covers a (clean) postal code: the code itself, or a code starting with the prefix. */
export function patternMatches(pattern: string, code: string): boolean {
  return isPrefix(pattern) ? code.startsWith(pattern.slice(0, -1)) : code === pattern;
}

/** How specific a pattern is: any exact code above every prefix, a longer prefix above a shorter one. */
export function specificity(pattern: string): number {
  return isPrefix(pattern) ? pattern.length - 1 : 1000 + pattern.length;
}

/** The most specific of the patterns that cover the code, or null when none does. */
export function mostSpecific(patterns: readonly string[], code: string): string | null {
  let best: string | null = null;
  for (const pattern of patterns) {
    if (patternMatches(pattern, code) && (best === null || specificity(pattern) > specificity(best))) best = pattern;
  }
  return best;
}

export type ZoneLike = { id: string; patterns: readonly string[]; position?: number };

/**
 * The zone of a postal code: the one whose matching pattern is the most specific (ties, which the database prevents for one market, by position and
 * id). Null when no zone covers it or no code is known yet: Rest of country.
 */
export function zoneFor<Z extends ZoneLike>(zones: readonly Z[], code: string | null): Z | null {
  if (!code) return null;
  let best: { zone: Z; score: number } | null = null;
  for (const zone of zones) {
    const pattern = mostSpecific(zone.patterns, code);
    if (pattern === null) continue;
    const score = specificity(pattern);
    if (
      best === null ||
      score > best.score ||
      (score === best.score && ((zone.position ?? 0) < (best.zone.position ?? 0) || ((zone.position ?? 0) === (best.zone.position ?? 0) && zone.id < best.zone.id)))
    ) {
      best = { zone, score };
    }
  }
  return best?.zone ?? null;
}

/** The patterns of `patterns` that another zone already holds, with that zone: the database refuses such a save (`shipping_zones.taken`). */
export function takenPatterns<Z extends ZoneLike & { name: string }>(patterns: readonly string[], others: readonly Z[], selfId: string | null): { pattern: string; zone: string }[] {
  const taken: { pattern: string; zone: string }[] = [];
  for (const pattern of patterns) {
    const other = others.find((z) => z.id !== selfId && z.patterns.includes(pattern));
    if (other) taken.push({ pattern, zone: other.name });
  }
  return taken;
}
