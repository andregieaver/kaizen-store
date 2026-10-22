/**
 * The words of draft orders and order changes as the admin shows them (D312 A4): the libraries and the server write their problems in English (`DRAFT_PROBLEMS`,
 * `ORDER_EDIT_PROBLEMS`, `EDIT_BLOCKS`, read by the AI manager's tools too); the screens say them in the person's language from the `drafts` catalogue. Pure.
 */
import { countWords, fillWords } from "./admin-fill";
import { draftsEn, type DraftsMessages } from "./admin-messages/drafts.en";
import { CASH_RULES } from "./cash-limits";

export type DraftsWords = DraftsMessages;

/**
 * A change's problem in the person's language: the catalogue's words for its code when the server's text is the code's own English (the server writes a few problems
 * of code `invalid` with words of their own: those stay as written).
 */
export function editProblemText(code: string, text: string, words: DraftsWords["edit"]): string {
  const english: Record<string, string> = { ...draftsEn.edit.problems, ...draftsEn.edit.blocks };
  const local: Record<string, string> = { ...words.problems, ...words.blocks };
  return english[code] === text && local[code] ? local[code] : text;
}

/** Why an order cannot be changed, in the person's language, from its code (`editBlock()`). */
export const editBlockWords = (reason: string, words: DraftsWords["edit"]): string | null => (words.blocks as Record<string, string>)[reason] ?? null;

/** Why an order cannot be changed, given in the code's English words (`orderEditProblemText()`), in the person's language; other text stays as written. */
export function blockTextWords(text: string, words: DraftsWords["edit"]): string {
  const code = Object.entries(draftsEn.edit.blocks).find(([, english]) => english === text)?.[0];
  return code ? ((words.blocks as Record<string, string>)[code] ?? text) : text;
}

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
