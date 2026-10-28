import Link from "next/link";

import { progressPercent, STATUS_WORDS, type JobKind, type JobPhase, type JobStatus } from "@/lib/data-job";
import { doneOfTotal, expiryWords, formatBytes, KIND_TITLES, momentText, wholeNumber, workingWords } from "@/lib/data-admin";

import { card, hint, secondary } from "./ui";
import { ButtonLink, Card, Chip, List, ListRow, RowActions, RowFact, RowLead } from "@/components/admin/ui";

/** What a job page draws of a job: a state with no path, no input name's folder and nothing of a person (`JobState` of `data-routes.ts`, and the job as the page read it). */
export type JobView = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  phase: JobPhase | null;
  rowsDone: number | null;
  rowsTotal: number | null;
  problem: string | null;
};

const UNIT: Record<JobKind, string> = { product_import: "products", product_export: "products", order_export: "rows", customer_export: "customers", redirect_import: "redirects", redirect_export: "redirects", inventory_import: "rows", inventory_export: "rows", customer_import: "rows" };

/** The progress of a job being made: a bar with its numbers, or the plain reason a job stopped. Presentational, so a test holds it. */
export function JobProgressView({ job }: { job: JobView }) {
  const percent = progressPercent(job.rowsDone, job.rowsTotal, job.status);
  const working = job.status === "checking" || job.status === "queued" || job.status === "running";
  const words = working ? workingWords(job.kind, job.status, job.phase) : STATUS_WORDS[job.status];
  const numbers = doneOfTotal(job.rowsDone, job.rowsTotal, UNIT[job.kind]);
  return (
    <section aria-label={KIND_TITLES[job.kind]} className={`${card} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title text-ink">{words}</h2>
        {numbers && <p className={hint}>{numbers}</p>}
      </div>
      {working && (
        <div
          role="progressbar"
          aria-label={words}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 overflow-hidden rounded-full bg-card"
        >
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.max(percent, working ? 3 : 0)}%` }} />
        </div>
      )}
      {working && <p className={hint}>You can leave this page. The work goes on, and the job is here when you come back.</p>}
      {job.status === "failed" && job.problem && (
        <p role="alert" className="text-sm text-danger-text">
          {job.problem}
        </p>
      )}
    </section>
  );
}

export type ExportFileView = { index: number; name: string; rows: number; bytes: number };

export type ExportJobRow = JobView & {
  createdAt: string;
  expiresAt: string | null;
  purged: boolean;
  files: ExportFileView[];
};

/** One Download button: a form that POSTs to the page's file route, which logs the download and sends the member to a signed address that lives a minute. */
export function DownloadButton({ action, jobId, part, label }: { action: string; jobId: string; part: number; label: string }) {
  return (
    <form method="post" action={action}>
      <input type="hidden" name="intent" value="download" />
      <input type="hidden" name="job" value={jobId} />
      <input type="hidden" name="part" value={part} />
      <button type="submit" className={secondary}>
        {label}
      </button>
    </form>
  );
}

/** A done export: each file with its size, rows and when it goes, and a Download button per file. */
export function ExportFiles({ job, action, timeZone, now }: { job: ExportJobRow; action: string; timeZone: string; now: Date }) {
  if (job.status !== "done" || job.purged || job.files.length === 0) return null;
  const total = job.files.reduce((n, f) => n + f.rows, 0);
  return (
    <section aria-label="Files" className={`${card} flex flex-col gap-3`}>
      <div>
        <h2 className="text-title text-ink">{job.files.length === 1 ? "Your file is ready" : `Your ${job.files.length} files are ready`}</h2>
        <p className={hint}>
          {wholeNumber(total)} rows
          {job.expiresAt ? `. ${expiryWords(job.expiresAt, now)} (${momentText(job.expiresAt, timeZone)}).` : "."} The download link is made when you press the button and works for a minute.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {job.files.map((file) => (
          <li key={file.index} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-card px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{file.name}</span>
              <span className={`${hint} block`}>
                {wholeNumber(file.rows)} rows, {formatBytes(file.bytes)}
              </span>
            </span>
            <DownloadButton action={action} jobId={job.id} part={file.index} label="Download" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The store's recent exports of a kind, newest first: when, how many rows, in what state and whether a file can still be downloaded. */
export function ExportJobList({ jobs, pageHref, timeZone, now }: { jobs: ExportJobRow[]; pageHref: string; timeZone: string; now: Date }) {
  if (jobs.length === 0) return null;
  return (
    <Card title="Recent exports" compact>
      <List label="Recent exports of this store, newest first">
        {jobs.map((job) => (
          <ListRow key={job.id}>
            <RowLead
              title={momentText(job.createdAt, timeZone)}
              href={`${pageHref}?job=${job.id}`}
              sub={
                job.status === "done" && !job.purged && job.expiresAt
                  ? expiryWords(job.expiresAt, now)
                  : job.status === "failed" && job.problem
                    ? job.problem
                    : undefined
              }
            />
            <RowFact className="hidden sm:block">
              {job.files.length > 0
                ? `${wholeNumber(job.files.reduce((n, f) => n + f.rows, 0))} rows`
                : job.rowsTotal !== null
                  ? `${wholeNumber(job.rowsTotal)} rows`
                  : "No rows yet"}
            </RowFact>
            <Chip signal={job.status === "done" ? "positive" : job.status === "failed" ? "danger" : job.status === "cancelled" ? "neutral" : "insight"} dot>
              {STATUS_WORDS[job.status]}
            </Chip>
            <RowActions>
              <ButtonLink href={`${pageHref}?job=${job.id}`} kind="quiet" size="dense">
                {job.status === "done" && !job.purged ? "Download" : "Open"}
              </ButtonLink>
            </RowActions>
          </ListRow>
        ))}
      </List>
    </Card>
  );
}
