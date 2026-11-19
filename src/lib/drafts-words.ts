/**
 * The words of draft orders and order changes as the admin shows them (D312 A4): the libraries and the server write their problems in English (`DRAFT_PROBLEMS`,
 * `ORDER_EDIT_PROBLEMS`, `EDIT_BLOCKS`, read by the AI manager's tools too); the screens say them in the person's language from the `drafts` catalogue. Pure.
 * Matching the server's English to a code is in `drafts-words-english.ts`, for the server (bloat review step 2.26).
 */
import { countWords, fillWords } from "./admin-fill";
import type { DraftsMessages } from "./admin-messages/drafts.en";
import { CASH_RULES } from "./cash-limits";

export type DraftsWords = DraftsMessages;

/** The cash rules as one sentence each, in the catalogue's words and the language's own number format (`cashRuleWords()` in English). */
export function cashRulesText(words: DraftsWords["cash"], locale: string): string {
  return Object.entries(CASH_RULES)
    .map(([country, rule]) => {
      const amount = new Intl.NumberFormat(locale, { style: "currency", currency: rule.currency, maximumFractionDigits: 0 }).format(rule.limitMinor / 100);
      return fillWords(rule.mode === "refuse" ? words.refuse : words.warn, { country, amount, unchecked: rule.verified ? "" : words.unchecked });
    })
    .join(" ");
}

/** The warning beside the Cash method, in the person's language. */
export const cashWarningText = (words: DraftsWords["cash"], locale: string): string => fillWords(words.warning, { rules: cashRulesText(words, locale) });

export { countWords, fillWords };
