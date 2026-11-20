/**
 * Server code and tests only: an admin client module must not import this (admin-bundle.scan.test.ts).
 * The server's English problems of an order change (D174), matched to their code and said in the person's language before the page
 * or the action hands them down.
 */
import { DRAFTS_WORDS } from "./admin-words/drafts";
import type { DraftsWords } from "./drafts-words";

/**
 * A change's problem in the person's language: the catalogue's words for its code when the server's text is the code's own English (the server writes a few problems
 * of code `invalid` with words of their own: those stay as written).
 */
export function editProblemText(code: string, text: string, words: DraftsWords["edit"]): string {
  const english: Record<string, string> = { ...DRAFTS_WORDS.en.edit.problems, ...DRAFTS_WORDS.en.edit.blocks };
  const local: Record<string, string> = { ...words.problems, ...words.blocks };
  return english[code] === text && local[code] ? local[code] : text;
}

/** Why an order cannot be changed, given in the code's English words (`orderEditProblemText()`), in the person's language; other text stays as written. */
export function blockTextWords(text: string, words: DraftsWords["edit"]): string {
  const code = Object.entries(DRAFTS_WORDS.en.edit.blocks).find(([, english]) => english === text)?.[0];
  return code ? ((words.blocks as Record<string, string>)[code] ?? text) : text;
}
