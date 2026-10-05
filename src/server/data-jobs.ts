import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { writeCsv, type Cell } from "@/lib/csv";
import { ORDER_SELECTION_MAX, DATA_EXPORTS_ACTIVE_MAX, DIRECT_EXPORT_MAX_ROWS, DOWNLOAD_LINK_SECONDS, EXPORT_MAX_ROWS, DATA_JOB_BUDGET_MS, JOB_ITEMS_KEEP_DAYS, JOB_ROW_KEEP_MONTHS, BULK_KEEP_DAYS } from "@/lib/data-limits";
import { isExport, isImport, type JobKind } from "@/lib/data-job";
import { parseOrderNumbers } from "@/lib/order-csv";
import type { PermissionKey } from "@/lib/permissions";

import { audit, type Membership } from "./auth";
import { countCustomers, customerExportReader, parseCustomerExportOptions, type CustomerExportOptions } from "./customer-export";
import { notifyReady } from "./data-job-emails";
import { JobStopped, buildDirect, runExport, type ExportReader } from "./data-export-run";
import {
  EXPORTS_BUCKET,
  IMPORTS_BUCKET,
  chunkPath,
  claimJob,
  exportFolderFiles,
  failJob,
  getJob,
  isJobId,
  jobFromRow,
  listItems,
  listJobsOf,
  releaseJob,
  scheduleJob,
  STORAGE_DOWN_PROBLEM,
  StorageDown,
  storageOf,
  type DataDeps,
  type DataJob,
} from "./data-job-store";
import { countOrderExportRows, orderExportReader, parseOrderExportOptions, resolveOrderNumbers, type OrderExportOptions } from "./order-export";
import { pgUuidArray } from "./pg-arrays";
import { NO_ACCESS, memberCan } from "./permissions";
import { countProductExportRows, parseProductExportOptions, productExportReader, type ProductExportOptions } from "./product-export";
import { applyImport, checkImport, dryCountsOf, registerImport, runImportApply, runImportCheck, startImportUpload, type StepResult } from "./product-import";
import { applyRedirectImport, checkRedirectImport, redirectDryCountsOf, redirectProblemsCsv, registerRedirectImport, runRedirectApply, runRedirectCheck, startRedirectUpload } from "./redirect-import";
import { countRedirectExportRows, parseRedirectExportOptions, redirectExportReader, type RedirectExportOptions } from "./redirect-export";
import { storeOf } from "./product-data";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * Imports and exports as jobs (D165, `docs/wave-2-data.md` 3.1, 5.2): the public API of the pipeline. A small export is a download at once; a large
 * one is a job a member starts, which is claimed (one run at a time), run in ticks (`after()`, the open page, the five-minute job), delivered by a
 * link the signed-in member presses (a signed address of 60 seconds, made on a POST and logged), never emailed. The file kinds, their rows and their
 * limits are the modules' (`product-export.ts`, `order-export.ts`, `customer-export.ts`, `product-import.ts`); this module starts, runs, cancels, serves
 * and prunes. Every function takes the member (or the store id) and carries the store id in every statement; a job of another store is "not found".
 * Order and customer files hold personal data: they need the OWNER, are logged, are never emailed, and an erasure removes the ready ones.
 */

/** What a member needs to start, see or download a job of a kind. A custom role can never hold `owner`, so it never exports personal data. */
export const JOB_KEY: Record<JobKind, PermissionKey> = {
  product_import: "products:write",
  product_export: "products:read",
  order_export: "owner",
  customer_export: "owner",
  redirect_import: "website:write",
  redirect_export: "website:read",
};

export const mayUseKind = (member: Pick<Membership, "role" | "kind" | "permissions">, kind: JobKind): boolean => memberCan(member, JOB_KEY[kind]);

const AUDIT_MADE: Record<string, string> = { product_export: "products.export_made", order_export: "order.exported", customer_export: "customer.exported", redirect_export: "redirects.export_made" };
const AUDIT_DOWNLOADED: Record<string, string> = { product_export: "products.export_downloaded", order_export: "order.export_downloaded", customer_export: "customer.export_downloaded", redirect_export: "redirects.export_downloaded" };
const AREA: Record<string, "products" | "orders" | "customers" | "website"> = { product_export: "products", order_export: "orders", customer_export: "customers", redirect_export: "website" };

const NOT_LOGGED = "The activity log could not be written, so no file was made. Try again.";

// ---------------------------------------------------------------------------
// Asking for an export: a download at once, or a job
// ---------------------------------------------------------------------------

/** Why an export was not made, as a code a page turns into a fixed sentence (`EXPORT_PROBLEM_TEXT`): never text from an address. */
export type ExportProblemCode = "forbidden" | "options" | "too_big" | "too_many" | "not_logged" | "no_orders" | "failed";

export const EXPORT_PROBLEM_TEXT: Record<ExportProblemCode, string> = {
  forbidden: NO_ACCESS,
  options: "The choices for the export could not be read. Check them and try again.",
  too_big: `This export has more than ${EXPORT_MAX_ROWS.toLocaleString("en")} rows. Choose a narrower period or filter.`,
  too_many: `${DATA_EXPORTS_ACTIVE_MAX} exports are already being made for this store. Wait for one to finish.`,
  not_logged: "The activity log could not be written, so no file was made. Try again.",
  no_orders: "None of those order numbers belong to this store.",
  failed: "The export could not be made. Try again.",
};

export type ExportRequest =
  | { ok: true; mode: "file"; filename: string; csv: string; rows: number; unknownNumbers: string[] }
  | { ok: true; mode: "job"; jobId: string; unknownNumbers: string[] }
  | { ok: false; problem: string; code: ExportProblemCode };

const refuse = (code: ExportProblemCode, problem: string = EXPORT_PROBLEM_TEXT[code]): { ok: false; problem: string; code: ExportProblemCode } => ({ ok: false, problem, code });

const today = () => new Date().toISOString().slice(0, 10);

const tooBig = (rows: number) => `This export has ${rows.toLocaleString("en")} rows and an export takes at most ${EXPORT_MAX_ROWS.toLocaleString("en")}. Choose a narrower period or filter.`;

async function startExportJob(member: Membership, kind: Exclude<JobKind, "product_import" | "redirect_import">, options: object, deps: DataDeps): Promise<{ ok: true; jobId: string } | { ok: false; problem: string; code: ExportProblemCode }> {
  try {
    const [row] = await db().execute<Row>(sql`
      select commerce.start_export_job(${member.store.id}::uuid, ${kind}, ${member.account.id}::uuid, ${JSON.stringify(options)}::jsonb, ${DATA_EXPORTS_ACTIVE_MAX}) as id
    `);
    const jobId = String(row.id);
    scheduleJob(deps, () => runJob(jobId, deps));
    return { ok: true, jobId };
  } catch (error) {
    const text = JSON.stringify({ m: (error as Error)?.message, c: (error as { cause?: { message?: string } })?.cause?.message });
    if (text.includes("data_job.too_many_exports")) return refuse("too_many");
    throw error;
  }
}

/** Logs and hands back a small file; a file whose log entry cannot be written is not handed back. */
async function serveDirect(member: Membership, kind: Exclude<JobKind, "product_import" | "redirect_import">, fileBase: string, built: { csv: string; rows: number }, details: Record<string, unknown>, unknownNumbers: string[]): Promise<ExportRequest> {
  try {
    await audit(member.account.id, member.store.id, AUDIT_MADE[kind], { rows: built.rows, direct: true, ...details }, { area: AREA[kind] });
  } catch (error) {
    console.error("[data-jobs] a direct export could not be logged", error);
    return refuse("not_logged", NOT_LOGGED);
  }
  return { ok: true, mode: "file", filename: `${fileBase}-${today()}.csv`, csv: built.csv, rows: built.rows, unknownNumbers };
}

/** A member asks for the product file: a download when it has at most 2,000 rows, else a job. */
export async function requestProductExport(member: Membership, raw: unknown, deps: DataDeps = {}): Promise<ExportRequest> {
  if (!mayUseKind(member, "product_export")) return refuse("forbidden");
  const parsed = parseProductExportOptions(raw);
  if (!parsed.ok) return refuse("options", parsed.problem);
  const options: ProductExportOptions = parsed.options;
  const { rows } = await countProductExportRows(member.store.id, options);
  if (rows > EXPORT_MAX_ROWS) return refuse("too_big", tooBig(rows));
  if (rows <= DIRECT_EXPORT_MAX_ROWS) {
    const built = await buildDirect(await productExportReader(member.store, options));
    if (built) return serveDirect(member, "product_export", "products", built, { dialect: options.dialect, scope: options.scope }, []);
  }
  const job = await startExportJob(member, "product_export", options, deps);
  return job.ok ? { ok: true, mode: "job", jobId: job.jobId, unknownNumbers: [] } : job;
}

/** A member (the owner) asks for the order file: a download when it has at most 2,000 rows, else a job. A pasted selection lists back the numbers that are not the store's. */
export async function requestOrderExport(member: Membership, raw: unknown, deps: DataDeps = {}): Promise<ExportRequest> {
  if (!mayUseKind(member, "order_export")) return refuse("forbidden");
  const parsed = parseOrderExportOptions(raw);
  if (!parsed.ok) return refuse("options", parsed.problem);
  const options: OrderExportOptions = parsed.options;
  let unknownNumbers: string[] = [];
  if (options.mode === "numbers") {
    const resolved = await resolveOrderNumbers(member.store.id, options.numbers ?? []);
    unknownNumbers = resolved.unknown;
    if (resolved.found.length === 0) return refuse("no_orders");
    options.numbers = resolved.found;
  }
  const { rows } = await countOrderExportRows(member.store, options);
  if (rows > EXPORT_MAX_ROWS) return refuse("too_big", tooBig(rows));
  const details = { mode: options.mode, layout: options.layout, profile: options.profile, copied: options.copied, dialect: options.dialect, ...(options.mode === "range" ? { from: options.from, to: options.to } : { selected: options.numbers?.length ?? 0 }) };
  if (rows <= DIRECT_EXPORT_MAX_ROWS) {
    const built = await buildDirect(await orderExportReader(member.store, options));
    if (built) return serveDirect(member, "order_export", "orders", built, details, unknownNumbers);
  }
  const job = await startExportJob(member, "order_export", options, deps);
  return job.ok ? { ok: true, mode: "job", jobId: job.jobId, unknownNumbers } : job;
}

/** A member (the owner) asks for the customer file: a download when it has at most 2,000 customers, else a job. */
export async function requestCustomerExport(member: Membership, raw: unknown, deps: DataDeps = {}): Promise<ExportRequest> {
  if (!mayUseKind(member, "customer_export")) return refuse("forbidden");
  const parsed = parseCustomerExportOptions(raw);
  if (!parsed.ok) return refuse("options", parsed.problem);
  const options: CustomerExportOptions = parsed.options;
  const rows = await countCustomers(member.store.id);
  if (rows > EXPORT_MAX_ROWS) return refuse("too_big", tooBig(rows));
  if (rows <= DIRECT_EXPORT_MAX_ROWS) {
    const built = await buildDirect(await customerExportReader(member.store, options));
    if (built) return serveDirect(member, "customer_export", "customers", built, { dialect: options.dialect }, []);
  }
  const job = await startExportJob(member, "customer_export", options, deps);
  return job.ok ? { ok: true, mode: "job", jobId: job.jobId, unknownNumbers: [] } : job;
}

/** A member asks for the redirect file (wave 2, second run, D168): the manual redirects (or all), a download when it has at most 2,000 rows, else a job. `website:read`. */
export async function requestRedirectExport(member: Membership, raw: unknown, deps: DataDeps = {}): Promise<ExportRequest> {
  if (!mayUseKind(member, "redirect_export")) return refuse("forbidden");
  const parsed = parseRedirectExportOptions(raw);
  if (!parsed.ok) return refuse("options", parsed.problem);
  const options: RedirectExportOptions = parsed.options;
  const rows = await countRedirectExportRows(member.store.id, options);
  if (rows > EXPORT_MAX_ROWS) return refuse("too_big", tooBig(rows));
  if (rows <= DIRECT_EXPORT_MAX_ROWS) {
    const built = await buildDirect(await redirectExportReader(member.store, options));
    if (built) return serveDirect(member, "redirect_export", "redirects", built, { dialect: options.dialect, scope: options.scope }, []);
  }
  const job = await startExportJob(member, "redirect_export", options, deps);
  return job.ok ? { ok: true, mode: "job", jobId: job.jobId, unknownNumbers: [] } : job;
}

// ---------------------------------------------------------------------------
// Reading jobs
// ---------------------------------------------------------------------------

/** A job of the store, when the member may see its kind; null otherwise (the same answer for another store's job). */
export async function jobFor(member: Membership, jobId: string): Promise<DataJob | null> {
  const job = await getJob(member.store.id, jobId);
  return job && mayUseKind(member, job.kind) ? job : null;
}

/** The store's jobs of a kind, newest first, when the member may see that kind. */
export async function listJobs(member: Membership, kind: JobKind, limit = 20): Promise<DataJob[]> {
  if (!mayUseKind(member, kind)) return [];
  return listJobsOf(member.store.id, [kind], limit);
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export type RunOutcome = "done" | "checked" | "paused" | "failed" | "busy" | "missing";

async function readerFor(job: DataJob, store: Store): Promise<{ reader: ExportReader }> {
  if (job.kind === "product_export") {
    const p = parseProductExportOptions(job.options);
    if (!p.ok) throw new JobStopped(p.problem);
    return { reader: await productExportReader(store, p.options) };
  }
  if (job.kind === "order_export") {
    const p = parseOrderExportOptions(job.options);
    if (!p.ok) throw new JobStopped(p.problem);
    return { reader: await orderExportReader(store, p.options) };
  }
  if (job.kind === "redirect_export") {
    const p = parseRedirectExportOptions(job.options);
    if (!p.ok) throw new JobStopped(p.problem);
    return { reader: await redirectExportReader(store, p.options) };
  }
  const p = parseCustomerExportOptions(job.options);
  if (!p.ok) throw new JobStopped(p.problem);
  return { reader: await customerExportReader(store, p.options) };
}

/** Every path an export has in the bucket: its parts and any chunk not yet assembled. */
export const exportPaths = (job: Pick<DataJob, "id" | "storeId" | "files" | "cursor">): string[] => {
  const chunks = Array.isArray((job.cursor as { chunks?: unknown }).chunks) ? ((job.cursor as { chunks: { n: number }[] }).chunks) : [];
  return [...job.files.map((f) => f.path), ...chunks.map((c) => chunkPath(job.storeId, job.id, c.n))];
};

/**
 * One run of a job: claims it (one run at a time), does the work for as long as the time allows, and lets go, to be taken up again by the next run. An
 * export ends `done` with its files, a dry run `checked`, an apply `done`; a run that stops is `paused` (the next run goes on where the cursor is), and a job
 * that cannot go on, or has had `DATA_JOB_MAX_ATTEMPTS` runs without progress, is `failed` with a plain reason.
 */
export async function runJob(id: string, deps: DataDeps = {}): Promise<RunOutcome> {
  const claimed = await claimJob(id);
  if (!claimed.ok) return claimed.reason === "stopped" ? "failed" : claimed.reason === "busy" ? "busy" : claimed.reason === "missing" ? "missing" : "missing";
  const job = claimed.job;
  const until = Date.now() + (deps.budgetMs ?? DATA_JOB_BUDGET_MS);
  try {
    if (isImport(job.kind)) {
      const redirects = job.kind === "redirect_import";
      const outcome = job.status === "checking" ? await (redirects ? runRedirectCheck : runImportCheck)(job, deps, until) : await (redirects ? runRedirectApply : runImportApply)(job, deps, until);
      // A run that stops lets go of the job so the next run (the page's, the cron's) takes it up at once.
      if (outcome === "paused") await releaseJob(job);
      return outcome;
    }
    const store = await storeOf(job.storeId);
    if (!store) throw new JobStopped("The store could not be found.");
    const { reader } = await readerFor(job, store);
    const outcome = await runExport(job, reader, deps, until, async (j, files, rows) => {
      // The entry is written before the job is done: a file that is not logged is never ready.
      await audit(j.requestedBy, j.storeId, AUDIT_MADE[j.kind], { job: j.id, rows, parts: files.length, direct: false }, { area: AREA[j.kind], target: { type: "data_job", id: j.id } });
    });
    if (outcome === "done") {
      await notifyReady(job, deps.send);
      return "done";
    }
    await releaseJob(job);
    return "paused";
  } catch (error) {
    if (error instanceof JobStopped) {
      await failJob(job, error.message);
      if (isExport(job.kind)) await removeExportFiles(job, deps);
      return "failed";
    }
    console.error(`[data-jobs] ${job.id} (${job.kind}) stopped:`, error);
    await releaseJob(job, error instanceof StorageDown ? STORAGE_DOWN_PROBLEM : null);
    return "paused";
  }
}

/**
 * Removes an export's files: the ones its row names and everything found in its folder `{store}/{job}/`, because a run that was stopped meanwhile may have
 * stored a file that no row names (`runExport()` removes what it can, this finds the rest). False when storage did not answer, so the caller keeps the job
 * to be tried again and does not call it clean.
 */
async function removeExportFiles(job: Pick<DataJob, "id" | "storeId" | "files" | "cursor">, deps: DataDeps): Promise<boolean> {
  const storage = storageOf(deps);
  if (!storage) return false;
  const listed = await exportFolderFiles(storage, job.storeId, job.id);
  if (listed === null) return false;
  const paths = [...new Set([...exportPaths(job), ...listed])];
  return paths.length === 0 ? true : storage.remove(EXPORTS_BUCKET, paths).catch(() => false);
}

/** The open page's step: runs the job once (nothing happens if another run holds it) and gives its state. Only a member who may see the job's kind. */
export async function tickJob(member: Membership, jobId: string, deps: DataDeps = {}): Promise<DataJob | null> {
  const before = await jobFor(member, jobId);
  if (!before) return null;
  if (["checking", "queued", "running"].includes(before.status)) await runJob(before.id, deps);
  return jobFor(member, jobId);
}

/** The five-minute job's share: takes up jobs nobody holds, for as long as there is time. Never throws. */
export async function runDataJobs(deps: DataDeps = {}): Promise<{ ran: number; done: number; failed: number }> {
  const totals = { ran: 0, done: 0, failed: 0 };
  try {
    const until = Date.now() + (deps.budgetMs ?? DATA_JOB_BUDGET_MS) * 2;
    const rows = await db().execute<Row>(sql`
      select id from commerce.data_jobs
      where status in ('checking', 'queued', 'running') and (claimed_until is null or claimed_until < now())
      order by created_at limit 5
    `);
    for (const row of rows) {
      if (Date.now() >= until) break;
      const outcome = await runJob(String(row.id), deps);
      if (outcome === "busy" || outcome === "missing") continue;
      totals.ran += 1;
      if (outcome === "done") totals.done += 1;
      if (outcome === "failed") totals.failed += 1;
    }
  } catch (error) {
    console.error("[data-jobs] the job failed:", error);
  }
  return totals;
}

/** Cancels a job that is not over: it stops after the current product or batch, and an export's files are removed. */
export async function cancelJob(member: Membership, jobId: string, deps: DataDeps = {}): Promise<{ ok: true } | { ok: false; problem: string }> {
  const job = await jobFor(member, jobId);
  if (!job) return { ok: false, problem: "This job could not be found." };
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs set status = 'cancelled', claimed_until = null
    where store_id = ${member.store.id}::uuid and id = ${job.id}::uuid and status in ('uploaded', 'checking', 'checked', 'queued', 'running')
    returning *
  `);
  if (rows.length === 0) return { ok: false, problem: "This job is already over." };
  const now = jobFromRow(rows[0]);
  if (isImport(job.kind)) {
    const redirects = job.kind === "redirect_import";
    await audit(member.account.id, member.store.id, redirects ? "redirects.import_cancelled" : "products.import_cancelled", { job: job.id, ...(redirects ? {} : { format: job.format }), file: job.inputName, ...(typeof now.counts === "object" ? { written: Number((now.counts as { created?: number }).created ?? 0) + Number((now.counts as { updated?: number }).updated ?? 0) } : {}) }, { area: redirects ? "website" : "products", target: { type: "data_job", id: job.id } }).catch((error) => console.error("[import] the cancel could not be logged", error));
  } else {
    await removeExportFiles(now, deps);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

export type DownloadResult = { ok: true; url: string; name: string } | { ok: false; problem: string };

/**
 * A done export's part for the member who presses Download: the signed address of 60 seconds, made now and logged before it is given (an entry that
 * cannot be written gives no address). There is no standing public link. `part` is the file's index.
 */
export async function downloadPart(member: Membership, jobId: string, part: number, deps: DataDeps = {}): Promise<DownloadResult> {
  const job = await jobFor(member, jobId);
  if (!job || !isExport(job.kind) || job.status !== "done" || job.purgedAt) return { ok: false, problem: "This file is not available." };
  const file = job.files[part];
  if (!file) return { ok: false, problem: "This file is not available." };
  const storage = storageOf(deps);
  if (!storage) return { ok: false, problem: "Storage was not available. Try again later." };
  try {
    await audit(member.account.id, member.store.id, AUDIT_DOWNLOADED[job.kind], { job: job.id, part, rows: file.rows }, { area: AREA[job.kind], target: { type: "data_job", id: job.id } });
  } catch (error) {
    console.error("[data-jobs] a download could not be logged", error);
    return { ok: false, problem: NOT_LOGGED };
  }
  const url = await storage.signedUrl(EXPORTS_BUCKET, file.path, file.name, DOWNLOAD_LINK_SECONDS);
  return url ? { ok: true, url, name: file.name } : { ok: false, problem: "Storage was not available. Try again later." };
}

/** The findings of an import as a CSV of problems (row numbers, handle, severity, code, column, sentence), through the one writer. */
export async function importProblemsCsv(member: Membership, jobId: string): Promise<{ ok: true; filename: string; csv: string } | { ok: false }> {
  const job = await jobFor(member, jobId);
  if (!job || job.kind !== "product_import") return { ok: false };
  const rows: Cell[][] = [["rows", "handle", "severity", "code", "column", "problem"]];
  for (let offset = 0; offset < 100_000; offset += 500) {
    const page = await listItems(member.store.id, job.id, { offset, limit: 500 });
    for (const item of page.items) {
      for (const m of item.messages) rows.push([item.rows.join(" "), item.ref, m.severity, m.code, m.column ?? null, m.text]);
    }
    if (page.items.length < 500) break;
  }
  return { ok: true, filename: `import-problems-${today()}.csv`, csv: writeCsv(rows, "standard") };
}

// ---------------------------------------------------------------------------
// Erasure and retention
// ---------------------------------------------------------------------------

/**
 * What an erased person could be in, read before the erasure changes it: when their customer record began and when their first order was placed.
 * A file made before either cannot hold them.
 */
export type ExportScope = { customerSince: string | null; orderSince: string | null };

/** Whether an order or customer file (a job of the store) can hold a person: an order file only through their orders, a customer file through their record or their orders. */
export function jobMayHold(job: Pick<DataJob, "kind" | "status" | "finishedAt" | "updatedAt">, scope: ExportScope): boolean {
  const since = job.kind === "order_export" ? scope.orderSince : [scope.customerSince, scope.orderSince].filter((d): d is string => d !== null).sort()[0] ?? null;
  if (since === null) return false;
  // A job that was only asked for has read nothing; one that is running may have a batch of this person (it is cancelled, so the batch is dropped).
  if (job.status === "queued") return false;
  const ended = job.finishedAt ?? (job.status === "running" ? null : job.updatedAt);
  return ended === null || ended >= since;
}

/**
 * Takes the store's order and customer files that can hold the erased person away (an erasure, D162, `storage:exports`): the ready ones are deleted from
 * storage and the jobs marked purged and expired, a running one is cancelled and its pieces removed, so no file made before the erasure outlives it. A file
 * that cannot hold the person (made before they existed in the store, or an order file when they have no order) is left alone: a stranger deleting their own
 * account must not take the owner's exports. The job is stopped FIRST (a run still writing then fails its next save and removes what it stored) and its
 * folder listed and cleared after; the owner exports again if they need a file without the person. Never throws; the number of jobs it took away.
 */
export async function removePersonalExports(storeId: string, deps: DataDeps = {}, scope: ExportScope = { customerSince: null, orderSince: null }): Promise<number> {
  try {
    if (scope.customerSince === null && scope.orderSince === null) return 0;
    const rows = await db().execute<Row>(sql`
      select * from commerce.data_jobs
      where store_id = ${storeId}::uuid and kind in ('order_export', 'customer_export') and purged_at is null and status in ('queued', 'running', 'done', 'expired', 'failed', 'cancelled')
    `);
    let taken = 0;
    for (const row of rows) {
      const job = jobFromRow(row);
      if (!jobMayHold(job, scope)) continue;
      const to = job.status === "done" ? "expired" : ["queued", "running"].includes(job.status) ? "cancelled" : job.status;
      if (to !== job.status) {
        await db().execute(sql`
          update commerce.data_jobs set status = ${to}, claimed_until = null
          where store_id = ${storeId}::uuid and id = ${job.id}::uuid and status = ${job.status}
        `);
      }
      if (!(await removeExportFiles(job, deps))) continue;
      await db().execute(sql`
        update commerce.data_jobs set files = '[]'::jsonb, purged_at = now(), claimed_until = null
        where store_id = ${storeId}::uuid and id = ${job.id}::uuid and purged_at is null
      `);
      taken += 1;
    }
    return taken;
  } catch (error) {
    console.error("[data-jobs] personal exports could not be removed", error);
    return 0;
  }
}

/**
 * Files in the exports bucket that no live job accounts for: the folder of a job whose row is gone, or whose files were taken away (purged) and that has a
 * file again, which only a run that was stopped while it wrote can leave. Found by listing the bucket (a store's folder, then its jobs' folders), so a file
 * no row names does not stay for ever. A job that is not purged is left to its own expiry. Bounded per night; never throws; the number of files removed.
 */
async function sweepOrphanExports(storage: NonNullable<ReturnType<typeof storageOf>>, maxFolders = 500): Promise<number> {
  let removed = 0;
  let seen = 0;
  try {
    const stores = await storage.list(EXPORTS_BUCKET, "");
    for (const s of stores ?? []) {
      if (!s.isFolder || !isJobId(s.name)) continue;
      const jobs = await storage.list(EXPORTS_BUCKET, s.name);
      const folders = (jobs ?? []).filter((j) => j.isFolder && isJobId(j.name));
      if (folders.length === 0) continue;
      const known = await db().execute<Row>(sql`select id, purged_at from commerce.data_jobs where store_id = ${s.name}::uuid and id = any(${pgUuidArray(folders.map((f) => f.name))}::uuid[])`);
      const state = new Map(known.map((r) => [String(r.id), r.purged_at !== null]));
      for (const f of folders) {
        if (seen >= maxFolders) return removed;
        seen += 1;
        const purged = state.get(f.name);
        // Not a job of this store, or one whose files were already taken away: nothing in it is the job's.
        if (purged !== undefined && !purged) continue;
        const files = await exportFolderFiles(storage, s.name, f.name);
        if (files && files.length > 0 && (await storage.remove(EXPORTS_BUCKET, files).catch(() => false))) removed += files.length;
      }
    }
  } catch (error) {
    console.error("[data-jobs] the sweep of the exports bucket failed:", error);
  }
  return removed;
}

/**
 * The daily clean-up (`docs/wave-2-data.md` 3.7), in application code and in batches, never throwing: an export's files 7 days after it is done, an
 * import's file 30 days after it ends (or after it was uploaded and never applied), a job's items and pictures 90 days after it ends, a job's row 12
 * months after, and bulk edits 90 days after they were made. A file that could not be removed is left for the next night.
 */
export async function pruneDataJobs(deps: DataDeps = {}): Promise<{ filesRemoved: number; expired: number; itemsDeleted: number; jobsDeleted: number; batchesDeleted: number; orphansRemoved: number }> {
  const out = { filesRemoved: 0, expired: 0, itemsDeleted: 0, jobsDeleted: 0, batchesDeleted: 0, orphansRemoved: 0 };
  try {
    const due = await db().execute<Row>(sql`
      select * from commerce.data_jobs
      where purged_at is null and (
        (kind not in ('product_import', 'redirect_import') and expires_at is not null and expires_at < now())
        or (kind not in ('product_import', 'redirect_import') and status in ('failed', 'cancelled') and finished_at < now() - interval '7 days')
        or (kind in ('product_import', 'redirect_import') and status in ('done', 'failed', 'cancelled') and finished_at < now() - interval '30 days')
        or (kind in ('product_import', 'redirect_import') and status in ('uploaded', 'checked') and created_at < now() - interval '30 days')
      )
      order by created_at limit 200
    `);
    const storage = storageOf(deps);
    for (const row of due) {
      const job = jobFromRow(row);
      if (!storage) break;
      const bucket = isImport(job.kind) ? IMPORTS_BUCKET : EXPORTS_BUCKET;
      // An export's files are what its folder holds, not only what its row names (a stopped run may have stored one the row never got).
      const listed = isImport(job.kind) ? [] : await exportFolderFiles(storage, job.storeId, job.id);
      if (listed === null) continue;
      const paths = isImport(job.kind) ? (job.inputPath ? [job.inputPath] : []) : [...new Set([...exportPaths(job), ...listed])];
      if (paths.length > 0 && !(await storage.remove(bucket, paths).catch(() => false))) continue;
      out.filesRemoved += paths.length;
      const expire = isExport(job.kind) ? job.status === "done" : job.status === "uploaded" || job.status === "checked";
      await db().execute(sql`
        update commerce.data_jobs
           set purged_at = now(), status = ${expire ? "expired" : job.status}, files = '[]'::jsonb, input_path = null, claimed_until = null
         where store_id = ${job.storeId}::uuid and id = ${job.id}::uuid and purged_at is null
      `);
      if (expire) out.expired += 1;
    }
    if (storage) out.orphansRemoved = await sweepOrphanExports(storage);
    const items = await db().execute<Row>(sql`
      with old as (select store_id, id from commerce.data_jobs where finished_at < now() - make_interval(days => ${JOB_ITEMS_KEEP_DAYS}))
      delete from commerce.data_job_items i using old where i.store_id = old.store_id and i.job_id = old.id returning 1 as x
    `);
    out.itemsDeleted = items.length;
    await db().execute(sql`
      with old as (select store_id, id from commerce.data_jobs where finished_at < now() - make_interval(days => ${JOB_ITEMS_KEEP_DAYS}))
      delete from commerce.data_job_assets a using old where a.store_id = old.store_id and a.job_id = old.id
    `);
    const jobs = await db().execute<Row>(sql`
      delete from commerce.data_jobs where finished_at < now() - make_interval(months => ${JOB_ROW_KEEP_MONTHS}) and status in ('done', 'failed', 'cancelled', 'expired') returning 1 as x
    `);
    out.jobsDeleted = jobs.length;
    // A batch with an undo newer than the cut-off stays with it (the undo names it).
    const batches = await db().execute<Row>(sql`
      delete from commerce.bulk_edit_batches b
      where b.created_at < now() - make_interval(days => ${BULK_KEEP_DAYS})
        and not exists (select 1 from commerce.bulk_edit_batches u where u.store_id = b.store_id and u.undo_of = b.id and u.created_at >= now() - make_interval(days => ${BULK_KEEP_DAYS}))
      returning 1 as x
    `);
    out.batchesDeleted = batches.length;
  } catch (error) {
    console.error("[data-jobs] the clean-up failed:", error);
  }
  return out;
}

// ---------------------------------------------------------------------------
// A pasted selection of order numbers
// ---------------------------------------------------------------------------

/** For the order export's form: which pasted numbers are the store's, which are not (listed back), and how many were too many. The owner's only. */
export async function checkOrderNumbers(member: Membership, pasted: string): Promise<{ ok: true; found: string[]; unknown: string[]; over: number } | { ok: false; problem: string }> {
  if (!mayUseKind(member, "order_export")) return { ok: false, problem: NO_ACCESS };
  const { numbers, over } = parseOrderNumbers(pasted, ORDER_SELECTION_MAX);
  const resolved = await resolveOrderNumbers(member.store.id, numbers);
  return { ok: true, found: resolved.found, unknown: resolved.unknown, over };
}

// ---------------------------------------------------------------------------
// Imports: the member's steps (the runs are the job's)
// ---------------------------------------------------------------------------

export { dryCountsOf, redirectDryCountsOf, redirectProblemsCsv, registerImport, registerRedirectImport, startImportUpload, startRedirectUpload };

/** Starts (or restarts, with other options) the dry run of an uploaded or checked import: it writes nothing to the catalogue. */
export const startImportCheck = (member: Membership, jobId: string, rawOptions: unknown, deps: DataDeps = {}): Promise<StepResult> => checkImport(member, jobId, rawOptions, (id) => runJob(id, deps), deps);

/** Starts the apply of an import whose dry run finished on the same file and options: logged first, products saved one at a time through the editor's door. */
export const startImportApply = (member: Membership, jobId: string, deps: DataDeps = {}): Promise<StepResult> => applyImport(member, jobId, (id) => runJob(id, deps), deps);

/** Starts (or restarts, with other options) the dry run of an uploaded or checked redirect import: it writes no redirect. */
export const startRedirectCheck = (member: Membership, jobId: string, rawOptions: unknown, deps: DataDeps = {}): Promise<StepResult> => checkRedirectImport(member, jobId, rawOptions, (id) => runJob(id, deps), deps);

/** Starts the apply of a redirect import whose dry run finished on the same file and options: logged first, lines written in chunks, each judged again at write time. */
export const startRedirectApply = (member: Membership, jobId: string, deps: DataDeps = {}): Promise<StepResult> => applyRedirectImport(member, jobId, (id) => runJob(id, deps), deps);
