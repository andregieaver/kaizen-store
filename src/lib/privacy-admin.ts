import { STAFF_TEXT } from "./privacy-text";

/**
 * The fixed sentences a refused download or erasure shows on the customer page (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 2): the
 * export route redirects back with a code in the address and the page turns it into one of these, so text from the address is never shown.
 */
export const EXPORT_PROBLEMS = {
  too_large: STAFF_TEXT.tooLarge,
  not_found: "There is nobody with that key in this store.",
} as const;

export type ExportProblem = keyof typeof EXPORT_PROBLEMS;

/** The sentence for `?export=` on the customer page, or null for anything that is not one of the codes. */
export function exportProblemOf(code: string | null | undefined): string | null {
  return code && Object.prototype.hasOwnProperty.call(EXPORT_PROBLEMS, code) ? EXPORT_PROBLEMS[code as ExportProblem] : null;
}
