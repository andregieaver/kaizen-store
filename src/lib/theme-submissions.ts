/**
 * Themes from outside (D344, `docs/wave-7-storefront.md` J), pure: what a submission holds, the limits its words keep, the states it goes
 * through and a new theme's address from its name. The server is `src/server/theme-submissions.ts`; the database holds the same limits and
 * moves a submission only forward (`theme_submissions_rules()`).
 */

export const SUBMISSION_KINDS = ["theme", "update"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

export const SUBMISSION_STATUSES = ["waiting", "reviewing", "approved", "rejected", "withdrawn"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Still to be decided: the author may withdraw it, and it counts towards `OPEN_SUBMISSIONS_MAX`. */
export const OPEN_STATUSES: readonly SubmissionStatus[] = ["waiting", "reviewing"];

/** The colour of a submission's state where it is listed. */
export const SUBMISSION_SIGNAL: Record<SubmissionStatus, "neutral" | "warning" | "positive" | "danger"> = {
  waiting: "warning",
  reviewing: "warning",
  approved: "positive",
  rejected: "danger",
  withdrawn: "neutral",
};

/** How many submissions an account may have waiting or in review at once. */
export const OPEN_SUBMISSIONS_MAX = 3;

export const SUBMISSION_LIMITS = { title: 80, summary: 200, description: 2000, notes: 2000, authorName: 80, reason: 1000 } as const;

export type SubmissionInput = {
  title: string;
  summary: string;
  description: string;
  authorName: string;
  /** An update's *What's new*. */
  notes?: string | null;
};

export type SubmissionProblem = "title" | "summary" | "description" | "authorName" | "notes";

/** What is wrong with what was typed, by field; empty when it can be submitted. Words are kept as typed, trimmed at the ends. */
export function submissionProblems(input: SubmissionInput, kind: SubmissionKind): SubmissionProblem[] {
  const problems: SubmissionProblem[] = [];
  const title = input.title.trim();
  if (kind === "theme" && (title.length === 0 || title.length > SUBMISSION_LIMITS.title)) problems.push("title");
  if (input.summary.trim().length > SUBMISSION_LIMITS.summary) problems.push("summary");
  if (input.description.trim().length > SUBMISSION_LIMITS.description) problems.push("description");
  const author = input.authorName.trim();
  if (author.length === 0 || author.length > SUBMISSION_LIMITS.authorName) problems.push("authorName");
  if ((input.notes ?? "").trim().length > SUBMISSION_LIMITS.notes) problems.push("notes");
  return problems;
}

/** Whether a submission in this state may be moved to the next (the database's rule, for the buttons). */
export function canMove(from: SubmissionStatus, to: SubmissionStatus): boolean {
  if (from === "waiting") return to === "reviewing" || to === "rejected" || to === "withdrawn";
  if (from === "reviewing") return to === "approved" || to === "rejected" || to === "withdrawn";
  return false;
}

/** A theme store address from a name (`/themes/{slug}`): lower case letters, digits and single hyphens, at most 60, never empty. */
export function themeSlugFrom(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "theme";
}

/** The address to try after `base` was taken: `base-2`, `base-3`, … within 60 characters. */
export function nextSlug(base: string, n: number): string {
  const tail = `-${n}`;
  return `${base.slice(0, 60 - tail.length).replace(/-+$/g, "")}${tail}`;
}
