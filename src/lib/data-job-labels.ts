/**
 * A data job's own words for a status, in English (bloat review step 2.50): beside `data-job.ts`, so the admin's
 * catalogues (`products`, `inventory`) take them from here and import no code. Imports nothing but types.
 */
import type { JobStatus } from "./data-job";

/** A job's own words for a status, for the page and the email. */
export const STATUS_WORDS: Record<JobStatus, string> = {
  uploaded: "File received",
  checking: "Checking the file",
  checked: "Checked, ready to import",
  queued: "Waiting to start",
  running: "Working",
  done: "Done",
  failed: "Stopped with a problem",
  cancelled: "Cancelled",
  expired: "Files removed",
};
