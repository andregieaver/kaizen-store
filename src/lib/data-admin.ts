/**
 * What the admin's pages for data in and out say and decide (D165, `docs/wave-2-data.md` 2 and 5.4), pure: the sentences of the export and import pages,
 * the stage an import is in, sizes, times and the counts a job shows. No database and nothing a person typed: a page passes in the facts and these turn
 * them into words, so a view test can hold them. The admin is English only. The sentences that touch the law (personal data, consent, a reduction against the
 * lowest price of 30 days) are listed in `docs/wave-2-data.md` section 8 for a person to read before real use.
 */
import { EXPORT_KEEP_DAYS } from "./data-limits";
import { isEnded, type JobKind, type JobPhase, type JobStatus } from "./data-job";

/** Shown on the order and customer export pages: the file holds personal data (GDPR Art. 5(1)(c), (e), (f)). Needs a human read (section 8). */
export const PERSONAL_DATA_WARNING = `This file contains personal data. Keep it only as long as you need it; it is deleted from here after ${EXPORT_KEEP_DAYS} days.`;

/** Shown on the customer export page: Kaizen records no marketing consent yet, so the file must never be used as a mailing list (section 2.5). */
export const NO_CONSENT_NOTE = "Kaizen does not record marketing consent yet. Do not treat this file as a mailing list.";

/** The main-currency columns of the order file: indicative, not for a tax return (section 2.3.3). */
export const MAIN_CURRENCY_NOTE =
  "The main-currency columns are indicative. They use the store's exchange rate at the time the file is made, and are blank for a currency the store has no rate for. They are not for a tax return.";

/** The order file is not a tax or accounting document (section 2.3.7). */
export const NOT_A_STATEMENT_NOTE =
  "This file is not a statement of account, an invoice register or a return. Your accountant's documents are the invoices and credit notes and the VAT, OSS and IOSS files.";

/** Orders paid in Stripe's test mode are in the file, marked (section 2.3.5, 13.2): an accountant's copy leaves the marked rows out. Needs a human read (section 8). */
export const TEST_PAYMENT_NOTE = "Orders paid in Stripe's test mode are in the file and marked test_payment = true. They are try-outs, not sales: leave those rows out of anything you give your accountant.";

/** Nothing in the file is sent anywhere: a large export is made as a job and downloaded here, after signing in (section 2.3.2). */
export const NEVER_EMAILED_NOTE = "A file is never sent by email. When a large export is ready you get an email with a link to this page, and download the file here.";

/** What a product file does not carry (section 2.1.4): said on the export page so a round trip holds no surprise. */
export const NOT_IN_PRODUCT_FILE = [
  "Purchase options (subscriptions)",
  "Download files",
  "Booking settings: staff, seasons, check-in times (appointments, stays and rentals)",
  "Custom fields that are not plain values (pictures, files, links, repeaters and the like)",
] as const;

/** An import never undoes as a whole; a bulk edit can be undone (section 2.2.4). */
export const IMPORT_CONFIRMATION =
  "Products are saved one at a time; a product with an error is left as it was. You cannot undo an import as a whole; a bulk edit can be undone.";

/** The Omnibus sentence of a bulk price change is `OMNIBUS_SENTENCE` in `bulk-edit.ts`; this is the one-line rule behind an import's compare-at column. */
export const COMPARE_AT_NOTE = "A compare-at price in a file is never imported: a reduction is shown to shoppers only against the lowest price of the last 30 days, which Kaizen takes from its own price history.";

// ---------------------------------------------------------------------------
// Sizes, times, counts
// ---------------------------------------------------------------------------

/** A size as a person reads it: `812 B`, `14.2 KB`, `3.5 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A number with thousands separators, the same on the server and in the browser. */
export const wholeNumber = (n: number): string => Math.round(n).toLocaleString("en-GB");

/** A moment as `5 Oct 2026, 14:22` in a time zone (the store's), the same on the server and in the browser. */
export function momentText(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date);
  }
}

/** How long a file is kept, in words: `expires in 6 days`, `expires today`, `removed`. */
export function expiryWords(expiresAt: string | null, now: Date): string {
  if (!expiresAt) return "";
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (Number.isNaN(left) || left <= 0) return "expired";
  const days = Math.floor(left / 86_400_000);
  if (days >= 1) return `expires in ${days} ${days === 1 ? "day" : "days"}`;
  const hours = Math.max(1, Math.floor(left / 3_600_000));
  return `expires in ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

const asNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** The counts of a dry run a checked import holds (`counts.dry`): what an apply would do. */
export function dryCountsOfJob(counts: Record<string, unknown>): { toCreate: number; toUpdate: number; unchanged: number; withProblems: number } {
  const d = (typeof counts.dry === "object" && counts.dry !== null ? counts.dry : {}) as Record<string, unknown>;
  return { toCreate: asNumber(d.toCreate), toUpdate: asNumber(d.toUpdate), unchanged: asNumber(d.unchanged), withProblems: asNumber(d.withProblems) };
}

export type AppliedCounts = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  drafted: number;
  failed: number;
  warnings: number;
  errors: number;
  pricesChanged: number;
  picturesFetched: number;
  termsCreated: number;
};

/** The counts of an applied (or applying) import (`counts` of the job). */
export function appliedCountsOfJob(counts: Record<string, unknown>): AppliedCounts {
  return {
    created: asNumber(counts.created),
    updated: asNumber(counts.updated),
    unchanged: asNumber(counts.unchanged),
    skipped: asNumber(counts.skipped),
    drafted: asNumber(counts.drafted),
    failed: asNumber(counts.failed),
    warnings: asNumber(counts.warnings),
    errors: asNumber(counts.errors),
    pricesChanged: asNumber(counts.pricesChanged),
    picturesFetched: asNumber(counts.picturesFetched),
    termsCreated: asNumber(counts.termsCreated),
  };
}

// ---------------------------------------------------------------------------
// Where an import is
// ---------------------------------------------------------------------------

/** The stage an import page draws: the status together with the phase (a `running` import is applying, a `checking` one checking). */
export type ImportStage = "uploaded" | "checking" | "checked" | "applying" | "done" | "failed" | "cancelled" | "expired";

export function importStage(status: JobStatus): ImportStage {
  if (status === "queued" || status === "running") return "applying";
  return status;
}

/** Whether the page should keep asking the server for the next step: a job being checked or applied. */
export const isWorking = (status: JobStatus): boolean => status === "checking" || status === "queued" || status === "running";

/** What the progress bar says: `Checking the file`, `Saving products`, `Preparing your file`, `Making the file`. */
export function workingWords(kind: JobKind, status: JobStatus, phase: JobPhase | null): string {
  if (kind === "product_import") return status === "checking" ? "Checking the file" : "Saving products";
  if (status === "queued") return "Waiting to start";
  return phase === "assemble" ? "Putting the file together" : "Preparing your file";
}

/** `120 of 400 rows` / `120 of 400 products`. */
export function doneOfTotal(done: number | null, total: number | null, unit: string): string {
  if (total === null || total === undefined) return done ? `${wholeNumber(done)} ${unit}` : "";
  return `${wholeNumber(done ?? 0)} of ${wholeNumber(total)} ${unit}`;
}

export const jobEnded = (status: JobStatus): boolean => isEnded(status);

/** The page of a kind of export job, after the store's address. */
export const exportPath = (kind: Exclude<JobKind, "product_import">): string => (kind === "product_export" ? "/products/export" : kind === "order_export" ? "/orders/export" : "/customers/export");

export const KIND_TITLES: Record<JobKind, string> = {
  product_import: "Product import",
  product_export: "Product export",
  order_export: "Order export",
  customer_export: "Customer export",
};

// ---------------------------------------------------------------------------
// Findings: the table's filter
// ---------------------------------------------------------------------------

export const SEVERITY_FILTERS = ["all", "error", "warning", "info"] as const;
export type SeverityFilter = (typeof SEVERITY_FILTERS)[number];

export const severityFilterOf = (value: unknown): SeverityFilter => (SEVERITY_FILTERS as readonly unknown[]).includes(value) ? (value as SeverityFilter) : "all";

export const SEVERITY_WORDS = { error: "Error", warning: "Warning", info: "Note" } as const;

/** The rows of a number list as one phrase: `3, 4 and 9`; more than five are summarised. */
export function rowsPhrase(rows: readonly number[]): string {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length <= 5) return sorted.length === 1 ? String(sorted[0]) : `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
  return `${sorted[0]} to ${sorted[sorted.length - 1]} (${sorted.length} rows)`;
}
