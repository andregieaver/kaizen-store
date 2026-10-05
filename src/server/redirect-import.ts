import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { writeCsv, type Cell } from "@/lib/csv";
import { EMPTY_COUNTS, summariseCounts, type ItemSummary, type JobCounts } from "@/lib/data-job";
import { REDIRECT_APPLY_CHUNK } from "@/lib/data-limits";
import { normaliseSource, normaliseTarget } from "@/lib/redirect-path";
import { PROBLEM_HEADER, readRedirectFile, type RedirectLine } from "@/lib/redirect-csv";
import type { FileFinding } from "@/lib/product-csv";
import { duplicateRows, parseRedirectOptions, planRedirectLines, redirectItemOf, writesOf, type LinePlan, type RedirectImportOptions } from "@/lib/redirect-plan";

import { audit, type Membership } from "./auth";
import {
  IMPORTS_BUCKET,
  failJob,
  finishJob,
  getJob,
  importPathPattern,
  listItems,
  putItems,
  safeName,
  saveProgress,
  scheduleJob,
  sha256Of,
  stillRunning,
  StorageDown,
  storageOf,
  type DataDeps,
  type DataJob,
  type ItemInput,
} from "./data-job-store";
import { JobStopped } from "./data-export-run";
import { NO_ACCESS, memberCan } from "./permissions";
import { storeOf } from "./product-data";
import { addressContextOf, indexWithOverlay, liveOf, manualCountOf, pathsOfIndex, refreshRedirects } from "./redirect-live";
import { writeLines } from "./redirects";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The redirect import (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2.4): upload, check (a dry run that writes nothing), apply, on the pipeline of
 * D165 (`commerce.data_jobs`, kind `redirect_import`, never a second one). The file is judged as ONE SET against what the store has, in the order of its
 * lines (`planRedirectLines()`, the same pure plan the single form uses, with what earlier chunks planned laid over the store); the apply writes in chunks of
 * 500 lines, each chunk in one transaction under the store's lock through `writeLines()`, EACH LINE JUDGED AGAIN against the store at that moment (the dry run
 * is advice: a product may have been renamed and a source become live since); a line with an error is skipped and listed, the others go on, and no redirect
 * is ever deleted by an import. Items are written by (job, line) so a run that was killed goes on where the cursor is and writes nothing twice. One redirect
 * import is open per store at a time. The activity log gets one pair of entries per job, never one per redirect.
 */

const WRITE = "website:write" as const;

// ---------------------------------------------------------------------------
// Upload and register
// ---------------------------------------------------------------------------

export type UploadStart = { ok: true; path: string; token: string; bucket: typeof IMPORTS_BUCKET } | { ok: false; problem: string };

/** A signed upload for the browser: one new path in the store's folder of the private imports bucket. */
export async function startRedirectUpload(member: Membership, fileName: string, deps: DataDeps = {}): Promise<UploadStart> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const storage = storageOf(deps);
  if (!storage) return { ok: false, problem: "Uploads are not set up on this server." };
  const path = `${member.store.id}/${randomUUID()}/${safeName(fileName, "redirects.csv")}`;
  const started = await storage.signedUpload(path);
  if (!started) return { ok: false, problem: "The upload could not be started. Try again." };
  return { ok: true, path, token: started.token, bucket: IMPORTS_BUCKET };
}

export type RegisterResult = { ok: true; jobId: string; lines: number } | { ok: false; problems: string[] };

const isUniqueViolation = (error: unknown): boolean => {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
};

/** A file's name as the member gave it, safe to show: no control characters, at most 120 characters. */
const shownName = (name: string): string => name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[/\\]/g, "-").trim().slice(0, 120) || "redirects.csv";

/**
 * Registers a file the browser uploaded: reads it, refuses it with a sentence naming the problem or limit (and removes it), or keeps it as a job in `uploaded`
 * with its SHA-256. One redirect import is open per store at a time.
 */
export async function registerRedirectImport(member: Membership, input: { path: string; name: string }, deps: DataDeps = {}): Promise<RegisterResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: [NO_ACCESS] };
  const storage = storageOf(deps);
  if (!storage) return { ok: false, problems: ["Uploads are not set up on this server."] };
  const storeId = member.store.id;
  if (typeof input.path !== "string" || !importPathPattern(storeId).test(input.path)) return { ok: false, problems: ["The file did not arrive. Choose it again."] };
  const refuse = async (problems: string[]): Promise<RegisterResult> => {
    await storage.remove(IMPORTS_BUCKET, [input.path]).catch(() => false);
    return { ok: false, problems };
  };
  const bytes = await storage.download(IMPORTS_BUCKET, input.path);
  if (!bytes) return { ok: false, problems: ["The file did not arrive. Choose it again."] };
  const read = readRedirectFile(bytes);
  if (!read.ok) return refuse(read.problems);
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.data_jobs (store_id, kind, status, format, requested_by, input_path, input_name, input_bytes, input_sha256, rows_total)
      values (${storeId}::uuid, 'redirect_import', 'uploaded', 'kaizen', ${member.account.id}::uuid, ${input.path}, ${shownName(input.name)}, ${bytes.length}, ${sha256Of(bytes)}, ${read.lines.length})
      returning id
    `);
    return { ok: true, jobId: String(row.id), lines: read.lines.length };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return refuse(["Another redirect import is open for this store. Finish it or cancel it first."]);
  }
}

// ---------------------------------------------------------------------------
// Check and apply: starting them
// ---------------------------------------------------------------------------

export type StepResult = { ok: true } | { ok: false; problem: string };

/** Starts (or restarts, with other options) the dry run of an uploaded or checked import. */
export async function checkRedirectImport(member: Membership, jobId: string, rawOptions: unknown, run: (id: string) => Promise<unknown>, deps: DataDeps = {}): Promise<StepResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== "redirect_import") return { ok: false, problem: "This import could not be found." };
  if (job.status !== "uploaded" && job.status !== "checked") return { ok: false, problem: job.status === "checking" ? "The file is being checked." : "This import can no longer be checked." };
  const options = parseRedirectOptions(rawOptions);
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = 'checking', phase = 'check', options = ${JSON.stringify(options)}::jsonb, cursor = '{}'::jsonb, counts = '{}'::jsonb,
           rows_done = null, rows_total = null, attempts = 0, claimed_until = null, problem = null
     where store_id = ${member.store.id}::uuid and id = ${job.id}::uuid and kind = 'redirect_import' and status in ('uploaded', 'checked')
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "This import can no longer be checked." };
  await db().execute(sql`delete from commerce.data_job_items where store_id = ${member.store.id}::uuid and job_id = ${job.id}::uuid`);
  scheduleJob(deps, () => run(job.id));
  return { ok: true };
}

export type RedirectDry = { toCreate: number; toReplace: number; unchanged: number; skipped: number; withErrors: number };

/** The numbers a checked job shows before it is applied. */
export const redirectDryCountsOf = (job: Pick<DataJob, "counts">): RedirectDry => {
  const d = (job.counts.dry ?? {}) as Record<string, unknown>;
  return { toCreate: Number(d.toCreate ?? 0), toReplace: Number(d.toReplace ?? 0), unchanged: Number(d.unchanged ?? 0), skipped: Number(d.skipped ?? 0), withErrors: Number(d.withErrors ?? 0) };
};

/**
 * Starts the apply of a checked import: the same file (its SHA-256 is checked again when the run begins) with the options it was checked with. The start is
 * written to the activity log first (`redirects.import_started`: counts, job and file name, never an address), and an import whose entry cannot be written
 * does not start.
 */
export async function applyRedirectImport(member: Membership, jobId: string, run: (id: string) => Promise<unknown>, deps: DataDeps = {}): Promise<StepResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: NO_ACCESS };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== "redirect_import") return { ok: false, problem: "This import could not be found." };
  if (job.status !== "checked") return { ok: false, problem: "Check the file first." };
  const dry = redirectDryCountsOf(job);
  if (dry.toCreate + dry.toReplace + dry.unchanged === 0) return { ok: false, problem: "No redirect in this file can be imported. Fix the problems the check found, or choose other options and check it again." };
  try {
    await audit(member.account.id, member.store.id, "redirects.import_started", { job: job.id, file: job.inputName, lines: job.rowsTotal, toCreate: dry.toCreate, toReplace: dry.toReplace }, { area: "website", target: { type: "data_job", id: job.id } });
  } catch (error) {
    console.error("[redirect-import] the start could not be written to the activity log", error);
    return { ok: false, problem: "The activity log could not be written, so the import was not started. Try again." };
  }
  const files = Number((job.cursor as { files?: unknown }).files ?? 0);
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = 'queued', phase = 'apply', cursor = ${JSON.stringify({ next: 0, files })}::jsonb, counts = ${JSON.stringify({ ...EMPTY_COUNTS, dry })}::jsonb,
           rows_done = 0, attempts = 0, claimed_until = null, problem = null
     where store_id = ${member.store.id}::uuid and id = ${job.id}::uuid and kind = 'redirect_import' and status = 'checked'
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "Check the file first." };
  scheduleJob(deps, () => run(job.id));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The file of a run
// ---------------------------------------------------------------------------

type Loaded = { lines: RedirectLine[]; fileFindings: FileFinding[]; duplicates: ReadonlySet<number> };

/** The file of a run, read from storage again at the start of EVERY run and held to the SHA-256 it was registered with: an apply is of the file that was checked. */
async function loadFile(job: DataJob, deps: DataDeps, store: Store): Promise<Loaded> {
  const storage = storageOf(deps);
  if (!storage || !job.inputPath) throw new StorageDown();
  const bytes = await storage.download(IMPORTS_BUCKET, job.inputPath);
  if (!bytes) throw new StorageDown();
  if (sha256Of(bytes) !== job.inputSha256) throw new JobStopped("The file is not the one that was checked. Upload it again.");
  const read = readRedirectFile(bytes);
  if (!read.ok) throw new JobStopped(read.problems[0]);
  return { lines: read.lines, fileFindings: read.findings, duplicates: duplicateRows(read.lines, addressContextOf(store)) };
}

async function prepare(job: DataJob): Promise<{ store: Store; options: RedirectImportOptions }> {
  const store = await storeOf(job.storeId);
  if (!store) throw new JobStopped("The store could not be found.");
  return { store, options: parseRedirectOptions(job.options) };
}

const chunkOf = (deps: DataDeps): number => Math.max(1, deps.chunkRows ?? REDIRECT_APPLY_CHUNK);

const itemOf = (seq: number, plan: LinePlan, dry: boolean): ItemInput => {
  const item = redirectItemOf(plan, dry);
  return { seq, kind: "redirect", ref: item.ref, rows: item.rows, outcome: item.outcome, messages: item.messages, changes: item.changes };
};

// ---------------------------------------------------------------------------
// The check: a dry run
// ---------------------------------------------------------------------------

type CheckCursor = { next: number; files: number; filesWritten: boolean; dry: RedirectDry; warnings: number; errors: number };

const checkCursor = (job: DataJob): CheckCursor => {
  const c = job.cursor as Partial<CheckCursor>;
  const d = (c.dry ?? {}) as Partial<RedirectDry>;
  return {
    next: Number(c.next ?? 0),
    files: Number(c.files ?? 0),
    filesWritten: c.filesWritten === true,
    dry: { toCreate: Number(d.toCreate ?? 0), toReplace: Number(d.toReplace ?? 0), unchanged: Number(d.unchanged ?? 0), skipped: Number(d.skipped ?? 0), withErrors: Number(d.withErrors ?? 0) },
    warnings: Number(c.warnings ?? 0),
    errors: Number(c.errors ?? 0),
  };
};

/**
 * Plans a chunk of lines against the store as it is now with the plan of the earlier chunks laid over it (`overlay`), and returns the plans. The live
 * addresses and the redirects the chunk names are read for the chunk, never the whole store.
 */
async function planChunk(store: Store, options: RedirectImportOptions, lines: readonly RedirectLine[], overlay: Map<string, string>, manualCount: number, duplicates: ReadonlySet<number>): Promise<LinePlan[]> {
  const ctx = addressContextOf(store);
  const seeds: string[] = [];
  for (const line of lines) {
    const from = normaliseSource(line.from, ctx);
    if (from.ok) seeds.push(from.source);
    const to = normaliseTarget(line.to, ctx);
    if (to.ok) seeds.push(to.path);
  }
  const index = await indexWithOverlay(store.id, seeds, overlay);
  const live = await liveOf(store.id, [...seeds, ...pathsOfIndex(index)]);
  return planRedirectLines(lines, { ctx, live, index, manualCount, options, duplicates });
}

/**
 * One run of a dry run: judges the lines chunk by chunk, writing an item for each and nothing to the redirects. A run that stops goes on where the cursor is:
 * the chunks before it are planned again (cheap, nothing is written) so the file is still judged as one set.
 */
export async function runRedirectCheck(job: DataJob, deps: DataDeps, until: number): Promise<"checked" | "paused"> {
  const p = await prepare(job);
  const loaded = await loadFile(job, deps, p.store);
  const cursor = checkCursor(job);
  const total = loaded.lines.length;
  if (!cursor.filesWritten) {
    await putItems(job, loaded.fileFindings.map((f, i): ItemInput => ({ seq: i, kind: "file", ref: null, rows: f.rows, outcome: "checked", messages: [f.finding], changes: {} })));
    cursor.files = loaded.fileFindings.length;
    cursor.filesWritten = true;
    cursor.errors = loaded.fileFindings.filter((f) => f.finding.severity === "error").length;
    cursor.warnings = loaded.fileFindings.filter((f) => f.finding.severity === "warning").length;
    if (!(await saveProgress(job, { cursor: { ...cursor }, rowsTotal: total, rowsDone: cursor.next }))) return "paused";
  }
  const overlay = new Map<string, string>();
  const baseCount = await manualCountOf(job.storeId);
  let created = 0;
  let at = 0;
  const size = chunkOf(deps);
  while (at < total) {
    const replay = at < cursor.next;
    if (!replay && Date.now() >= until) return "paused";
    const take = replay ? Math.min(size, cursor.next - at) : size;
    const lines = loaded.lines.slice(at, at + take);
    const plans = await planChunk(p.store, p.options, lines, overlay, baseCount + created, loaded.duplicates);
    for (const w of writesOf(plans)) overlay.set(w.source, w.target);
    created += plans.filter((x) => x.action === "create").length;
    if (!replay) {
      const summaries: ItemSummary[] = [];
      const items: ItemInput[] = plans.map((plan, i) => {
        summaries.push({ outcome: plan.outcome, messages: plan.findings });
        for (const f of plan.findings) {
          if (f.severity === "error") cursor.errors += 1;
          if (f.severity === "warning") cursor.warnings += 1;
        }
        if (plan.action === "create") cursor.dry.toCreate += 1;
        else if (plan.action === "replace") cursor.dry.toReplace += 1;
        else if (plan.action === "unchanged") cursor.dry.unchanged += 1;
        else if (plan.action === "skip") cursor.dry.skipped += 1;
        else cursor.dry.withErrors += 1;
        return itemOf(cursor.files + at + i, plan, true);
      });
      await putItems(job, items);
      cursor.next = at + lines.length;
      if (!(await saveProgress(job, { cursor: { ...cursor }, rowsDone: cursor.next }))) return "paused";
      if (!(await stillRunning(job))) return "paused";
    }
    at += lines.length;
  }
  const counts = { ...cursor.dry, dry: cursor.dry, warnings: cursor.warnings, errors: cursor.errors };
  const ended = await finishJob(job, { status: "checked", counts, cursor: { ...cursor }, rowsDone: total, rowsTotal: total, phase: "check" });
  return ended ? "checked" : "paused";
}

// ---------------------------------------------------------------------------
// The apply
// ---------------------------------------------------------------------------

type ApplyCursor = { next: number; files: number };

const applyCursor = (job: DataJob): ApplyCursor => {
  const c = job.cursor as Partial<ApplyCursor>;
  return { next: Number(c.next ?? 0), files: Number(c.files ?? 0) };
};

/**
 * One run of an apply: chunks of lines, each chunk one transaction under the store's lock with every line judged again against the store at that moment,
 * the items and counts saved after each chunk. A chunk that was written but whose items were not saved (a run killed between) is planned again by the next
 * run: its lines are then `unchanged`, and nothing is written twice.
 */
export async function runRedirectApply(job: DataJob, deps: DataDeps, until: number): Promise<"done" | "paused"> {
  const p = await prepare(job);
  const loaded = await loadFile(job, deps, p.store);
  const cursor = applyCursor(job);
  const total = loaded.lines.length;
  const dry = (job.counts.dry ?? {}) as Record<string, unknown>;
  let counts: JobCounts = { ...EMPTY_COUNTS, ...(Object.fromEntries(Object.entries(job.counts).filter(([k]) => k in EMPTY_COUNTS)) as Partial<JobCounts>) };
  let processed = 0;
  const size = chunkOf(deps);
  while (cursor.next < total) {
    if (Date.now() >= until) return "paused";
    const lines = loaded.lines.slice(cursor.next, cursor.next + size);
    const result = await db().transaction((tx) => writeLines(tx, p.store, job.requestedBy, "import", lines, p.options, { duplicates: loaded.duplicates }));
    if (result.written > 0 || result.replacedAutomatic > 0) refreshRedirects(p.store.id);
    processed += lines.length;
    // A test's way of killing a run after a chunk was written and before it was recorded.
    if (deps.stopAfter !== undefined && processed >= deps.stopAfter) throw new Error("the run was stopped (test)");
    const summaries: ItemSummary[] = [];
    const items = result.plans.map((plan, i) => {
      summaries.push({ outcome: plan.outcome, messages: plan.findings });
      return itemOf(cursor.files + cursor.next + i, plan, false);
    });
    await putItems(job, items);
    const add = summariseCounts(summaries);
    counts = Object.fromEntries(Object.keys(EMPTY_COUNTS).map((k) => [k, (counts as Record<string, number>)[k] + (add as Record<string, number>)[k]])) as JobCounts;
    cursor.next += lines.length;
    if (!(await saveProgress(job, { cursor: { ...cursor }, counts: { ...counts, dry }, rowsDone: cursor.next, rowsTotal: total }))) return "paused";
    if (!(await stillRunning(job))) return "paused";
  }
  const ended = await finishJob(job, { status: "done", counts: { ...counts, dry }, cursor: { ...cursor }, rowsDone: total, rowsTotal: total, phase: "apply", keepDays: 30 });
  if (!ended) return "paused";
  await audit(job.requestedBy, job.storeId, "redirects.import_applied", { job: job.id, file: job.inputName, created: counts.created, updated: counts.updated, unchanged: counts.unchanged, skipped: counts.skipped, failed: counts.failed }, { area: "website", target: { type: "data_job", id: job.id } }).catch((error) =>
    console.error("[redirect-import] the end could not be written to the activity log", error),
  );
  return "done";
}

/** A job that could not go on: failed with a plain reason, never a quoted cell. */
export const stopRedirectImport = failJob;

// ---------------------------------------------------------------------------
// The problems as a file
// ---------------------------------------------------------------------------

/**
 * The findings of a redirect import as a CSV (row, redirect_from, redirect_to, severity, code, message), through the one writer. The two addresses are the cells
 * of the file as typed while its bytes are still kept; after that, the normalised address of the line. `website:write`.
 */
export async function redirectProblemsCsv(member: Membership, jobId: string, deps: DataDeps = {}): Promise<{ ok: true; filename: string; csv: string } | { ok: false }> {
  if (!memberCan(member, WRITE)) return { ok: false };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== "redirect_import") return { ok: false };
  const typed = new Map<number, RedirectLine>();
  const storage = storageOf(deps);
  if (storage && job.inputPath && !job.purgedAt) {
    const bytes = await storage.download(IMPORTS_BUCKET, job.inputPath).catch(() => null);
    const read = bytes ? readRedirectFile(bytes) : null;
    if (read?.ok) for (const line of read.lines) typed.set(line.row, line);
  }
  const rows: Cell[][] = [[...PROBLEM_HEADER]];
  for (let offset = 0; offset < 200_000; offset += 500) {
    const page = await listItems(member.store.id, job.id, { offset, limit: 500 });
    for (const item of page.items) {
      const line = typed.get(item.rows[0] ?? -1);
      for (const m of item.messages) rows.push([item.rows[0] ?? null, line?.from ?? item.ref ?? null, line?.to ?? null, m.severity, m.code, m.text]);
    }
    if (page.items.length < 500) break;
  }
  return { ok: true, filename: `redirect-import-problems-${new Date().toISOString().slice(0, 10)}.csv`, csv: writeCsv(rows, "standard") };
}
