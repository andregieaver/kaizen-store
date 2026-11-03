/**
 * What an owner may write before and after a product's price (D429, `price-words.ts`): short plain words, at most `PRICE_WORD_MAX`
 * characters, with no tag, line break or control character, no percentage (a reduction is announced only with its 30-day price, which the
 * store shows itself from `prior_30d_minor`) and nothing the claims filter finds (`findClaims()`: best or lowest price, urgency or scarcity, generic green
 * claims, an amount of money or a stock level). Shared by the settings page, the product editor and the server, which checks again.
 */
import { CLAIM_LABELS, findClaims, type ClaimKind } from "./claims";
import { PRICE_WORD_MAX, type PriceWords, type WordsByLocale } from "./price-words";

export type PriceWordProblem =
  | { kind: "long"; max: number }
  | { kind: "plain" }
  | { kind: "percent" }
  | { kind: "claim"; claim: ClaimKind; phrase: string };

/** Words as typed, tidied: spaces at the ends taken off and runs of spaces made one. */
export const cleanPriceWord = (text: string): string => text.replace(/\s+/g, " ").trim();

/** What is wrong with one prefix or suffix, or null. Checks the words as they will be kept (`cleanPriceWord()`). */
export function priceWordProblem(typed: string): PriceWordProblem | null {
  const text = cleanPriceWord(typed);
  if ([...text].length > PRICE_WORD_MAX) return { kind: "long", max: PRICE_WORD_MAX };
  if (/[<>\u0000-\u001f\u007f\u2028\u2029]/.test(typed.trim())) return { kind: "plain" };
  if (/\d\s*%|%\s*\d/.test(text)) return { kind: "percent" };
  const [claim] = findClaims(text);
  return claim ? { kind: "claim", claim: claim.kind, phrase: claim.phrase } : null;
}

/** Every problem of a set of words by language, with where it is, in the order of the languages given. */
export function wordsProblems(
  byLocale: WordsByLocale,
  locales: readonly string[],
): { locale: string; place: keyof PriceWords; problem: PriceWordProblem }[] {
  const found: { locale: string; place: keyof PriceWords; problem: PriceWordProblem }[] = [];
  for (const locale of locales) {
    const words = byLocale[locale];
    if (!words) continue;
    for (const place of ["prefix", "suffix"] as const) {
      const problem = priceWordProblem(words[place]);
      if (problem) found.push({ locale, place, problem });
    }
  }
  return found;
}

/** Words by language as they are kept: each word tidied, only the languages given. */
export function cleanWords(byLocale: WordsByLocale, locales: readonly string[]): WordsByLocale {
  const kept: WordsByLocale = {};
  for (const locale of locales) {
    const words = byLocale[locale];
    if (words) kept[locale] = { prefix: cleanPriceWord(words.prefix), suffix: cleanPriceWord(words.suffix) };
  }
  return kept;
}

const PLACES: Record<keyof PriceWords, string> = { prefix: "Before the price", suffix: "After the price" };

/**
 * A problem as a plain English sentence, for a save that refuses it without the admin's catalogue at hand (`saveProduct()`, the AI
 * manager's tools): "Before the price in nb-NO: at most 24 characters."
 */
export function priceWordSentence({ locale, place, problem }: { locale: string; place: keyof PriceWords; problem: PriceWordProblem }): string {
  const where = `${PLACES[place]} in ${locale}`;
  switch (problem.kind) {
    case "long":
      return `${where}: at most ${problem.max} characters.`;
    case "plain":
      return `${where}: write plain words, with no tags, line breaks or special spaces.`;
    case "percent":
      return `${where}: leave percentages out; the store shows a reduction itself, with the lowest price of the last 30 days.`;
    case "claim":
      return `${where}: "${problem.phrase}" could mislead shoppers (${CLAIM_LABELS[problem.claim].toLowerCase()}). Write it another way.`;
  }
}
