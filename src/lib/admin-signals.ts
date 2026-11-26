/**
 * Heatmaps and recordings of how store owners use the admin (D895 phase 3b, `docs/dpia-admin-use.md`), pure: the lock's questions, the
 * notice's version a choice is given under, and the cookie that tells the owner's own browser what they chose (the server checks the
 * stored choice again on everything it is sent, so the cookie alone opens nothing).
 */
import { LEGAL_REVIEWS } from "./legal-reviews";

/** The legal review whose questions must each be answered by a Legal account before the switch can open. */
export const ADMIN_USE_REVIEW = "admin-use";

/** The questions of that review (every point but "Anything else"). */
export const ADMIN_USE_QUESTIONS: readonly string[] = (LEGAL_REVIEWS.find((r) => r.slug === ADMIN_USE_REVIEW)?.items ?? [])
  .map((i) => i.key)
  .filter((key) => key !== "overall");

/** The notice a choice was given under; a change to what is collected gets a new version, and owners are asked again. */
export const ADMIN_USE_NOTICE = "2026-11-26";

/** The questions not yet answered by a Legal account, in the review's order. */
export const unansweredQuestions = (answeredByLegal: Iterable<string>): string[] => {
  const answered = new Set(answeredByLegal);
  return ADMIN_USE_QUESTIONS.filter((key) => !answered.has(key));
};

export type AdminSignalChoice = { heatmaps: boolean; recordings: boolean };

/** The value of the browser's cookie (`admin-use-cookie.ts`) for a choice. */
export const cookieValueOf = (choice: AdminSignalChoice): "0" | "h" | "hr" => (choice.recordings ? "hr" : choice.heatmaps ? "h" : "0");

/** A choice from a form: recordings only with heatmaps (a person who refuses heatmaps is never recorded). */
export function choiceFromForm(heatmaps: boolean, recordings: boolean): AdminSignalChoice {
  return { heatmaps, recordings: heatmaps && recordings };
}
