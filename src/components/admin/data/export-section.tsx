import { isWorking } from "@/lib/data-admin";
import type { JobKind } from "@/lib/data-job";
import type { Membership } from "@/server/auth";
import { jobFor, listJobs } from "@/server/data-jobs";
import type { DataJob } from "@/server/data-job-store";

import { JobTracker } from "./job-tracker";
import { ExportFiles, ExportJobList, JobProgressView, type ExportJobRow } from "./job-views";

const rowOf = (job: DataJob): ExportJobRow => ({
  id: job.id,
  kind: job.kind,
  status: job.status,
  phase: job.phase,
  rowsDone: job.rowsDone,
  rowsTotal: job.rowsTotal,
  problem: job.problem,
  createdAt: job.createdAt,
  expiresAt: job.expiresAt,
  purged: job.purgedAt !== null,
  files: job.files.map((f, index) => ({ index, name: f.name, rows: f.rows, bytes: f.bytes })),
});

/**
 * What an export page shows under its form: the job the address names (`?job=`), or the newest one still being made, with its progress and, when it is
 * done, its files and a Download button for each; then the store's recent exports of the kind. Read for the member's store only (`jobFor()` and
 * `listJobs()` answer nothing for a job of another store or a kind the member may not see). Server-rendered; only the tracker is a client component.
 */
export async function ExportSection({ member, kind, jobId, base, now }: { member: Membership; kind: Exclude<JobKind, "product_import" | "redirect_import" | "inventory_import">; jobId: string | null; base: string; now: Date }) {
  const timeZone = member.store.timeZone;
  const [named, recent] = await Promise.all([jobId ? jobFor(member, jobId) : Promise.resolve(null), listJobs(member, kind, 10)]);
  const named_ = named && named.kind === kind ? named : null;
  const shown = named_ ?? recent.find((j) => isWorking(j.status)) ?? null;
  const row = shown ? rowOf(shown) : null;
  return (
    <div className="flex flex-col gap-4">
      {row && isWorking(row.status) && <JobTracker tickUrl={`${base}/${row.id}/tick`} initial={row} />}
      {row && !isWorking(row.status) && row.status !== "done" && <JobProgressView job={row} />}
      {row && <ExportFiles job={row} action={`${base}/file`} timeZone={timeZone} now={now} />}
      <ExportJobList jobs={recent.map(rowOf)} pageHref={base} timeZone={timeZone} now={now} />
    </div>
  );
}
