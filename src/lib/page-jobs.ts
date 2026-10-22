/**
 * The AI manager's work on pages after its answer (D308, `docs/ai-autopilot.md` 4.1, `commerce.page_ai_jobs`): a page built from a brief,
 * and each picture of a page it built or changed. Pure, so the schema's checks and the server share the lists.
 */

export const PAGE_JOB_KINDS = ["build", "picture"] as const;
export type PageJobKind = (typeof PAGE_JOB_KINDS)[number];

/** `waiting` to be done; `done`; `gone` when its page (or a picture's place in it) is no longer there; `failed` after its last try. */
export const PAGE_JOB_STATUSES = ["waiting", "done", "gone", "failed"] as const;
export type PageJobStatus = (typeof PAGE_JOB_STATUSES)[number];

/** Tries before a job is given up, with its last problem kept for the owner. */
export const PAGE_JOB_TRIES = 3;

/** Done, gone and failed jobs are kept this long for the owner to ask about, then deleted (`prunePageJobs()`). */
export const PAGE_JOB_DAYS = 30;
