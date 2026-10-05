import "server-only";

import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { DATA_JOB_CLAIM_MINUTES, DATA_JOB_MAX_ATTEMPTS } from "@/lib/data-limits";
import { isEnded, type Finding, type ItemOutcome, type JobKind, type JobPhase, type JobStatus } from "@/lib/data-job";
import { publicEnv } from "@/lib/env";
import { supabaseKeyKind } from "@/lib/supabase-key";

import { pgTextArray } from "./pg-arrays";

type Row = Record<string, unknown>;

/**
 * The rows and files of data jobs (D165, `docs/wave-2-data.md` 3 and 5.2): reading a job, claiming it for one run at a time, saving its
 * progress, writing its items, and the two private buckets. The runners (`product-import.ts`, `product-export.ts`, `order-export.ts`,
 * `customer-export.ts`) import only this module; `data-jobs.ts` imports the runners and is the public API. Every statement carries the
 * store id (or the job id, which a caller read with the store id), and no function here deletes a job row: files and old rows are
 * removed by `pruneDataJobs()`.
 */

export const IMPORTS_BUCKET = "imports";
export const EXPORTS_BUCKET = "exports";

export type DataJobFile = { path: string; name: string; rows: number; bytes: number; sha256: string };

export type DataJob = {
  id: string;
  storeId: string;
  kind: JobKind;
  status: JobStatus;
  phase: JobPhase | null;
  format: "kaizen" | "shopify" | null;
  options: Record<string, unknown>;
  requestedBy: string;
  inputPath: string | null;
  inputName: string | null;
  inputBytes: number | null;
  inputSha256: string | null;
  rowsTotal: number | null;
  rowsDone: number | null;
  counts: Record<string, unknown>;
  cursor: Record<string, unknown>;
  files: DataJobFile[];
  problem: string | null;
  attempts: number;
  claimedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  purgedAt: string | null;
};

const iso = (value: unknown): string | null => (value === null || value === undefined ? null : new Date(String(value)).toISOString());
const obj = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export function jobFromRow(row: Row): DataJob {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(row.id),
    storeId: String(row.store_id),
    kind: String(row.kind) as JobKind,
    status: String(row.status) as JobStatus,
    phase: row.phase ? (String(row.phase) as JobPhase) : null,
    format: row.format ? (String(row.format) as "kaizen" | "shopify") : null,
    options: obj(row.options),
    requestedBy: String(row.requested_by),
    inputPath: row.input_path ? String(row.input_path) : null,
    inputName: row.input_name ? String(row.input_name) : null,
    inputBytes: num(row.input_bytes),
    inputSha256: row.input_sha256 ? String(row.input_sha256) : null,
    rowsTotal: num(row.rows_total),
    rowsDone: num(row.rows_done),
    counts: obj(row.counts),
    cursor: obj(row.cursor),
    files: Array.isArray(row.files) ? (row.files as DataJobFile[]) : [],
    problem: row.problem ? String(row.problem) : null,
    attempts: Number(row.attempts ?? 0),
    claimedUntil: iso(row.claimed_until),
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    expiresAt: iso(row.expires_at),
    purgedAt: iso(row.purged_at),
  };
}

export const isJobId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** A job of the store, by id; null for another store's job or an id that is none (the same answer for both). */
export async function getJob(storeId: string, id: string): Promise<DataJob | null> {
  if (!isJobId(id)) return null;
  const [row] = await db().execute<Row>(sql`select * from commerce.data_jobs where store_id = ${storeId}::uuid and id = ${id}::uuid`);
  return row ? jobFromRow(row) : null;
}

/** The store's jobs of some kinds, newest first. */
export async function listJobsOf(storeId: string, kinds: readonly JobKind[], limit = 20): Promise<DataJob[]> {
  const rows = await db().execute<Row>(sql`
    select * from commerce.data_jobs
    where store_id = ${storeId}::uuid and kind = any(${pgTextArray(kinds)}::text[])
    order by created_at desc, id limit ${Math.min(Math.max(1, limit), 100)}
  `);
  return rows.map(jobFromRow);
}

// ---------------------------------------------------------------------------
// Claiming, progress and the end
// ---------------------------------------------------------------------------

export type Claimed = { ok: true; job: DataJob } | { ok: false; reason: "busy" | "missing" | "ended" | "stopped" };

/** Storage did not answer: the run stops and is tried again; the reason is kept, and after the attempts the job is failed with it. */
export class StorageDown extends Error {}
export const STORAGE_DOWN_PROBLEM = "Storage was not available, so the job could not be finished. Try again later.";

/** The plain reason a job that never made progress stops. */
export const STOPPED_PROBLEM = "The job stopped because of a problem on our side and was tried several times. Nothing is lost: what was written is kept. Start it again.";

/**
 * Takes a job for one run (`claimed_until` an expiry, as `store_copies` are): a checking, queued or running job nobody holds. Taking a queued
 * job starts it. The attempts count runs without progress (`saveProgress()` sets it back to 1); past `DATA_JOB_MAX_ATTEMPTS` the job is failed.
 */
export async function claimJob(id: string): Promise<Claimed> {
  if (!isJobId(id)) return { ok: false, reason: "missing" };
  const [row] = await db().execute<Row>(sql`
    update commerce.data_jobs
       set claimed_until = now() + make_interval(mins => ${DATA_JOB_CLAIM_MINUTES}), attempts = attempts + 1,
           status = case when status = 'queued' then 'running' else status end,
           started_at = case when status = 'queued' then coalesce(started_at, now()) else started_at end
     where id = ${id}::uuid and status in ('checking', 'queued', 'running') and (claimed_until is null or claimed_until < now())
    returning *
  `);
  if (!row) {
    const [existing] = await db().execute<Row>(sql`select status from commerce.data_jobs where id = ${id}::uuid`);
    if (!existing) return { ok: false, reason: "missing" };
    return { ok: false, reason: isEnded(String(existing.status) as JobStatus) ? "ended" : "busy" };
  }
  const job = jobFromRow(row);
  if (job.attempts > DATA_JOB_MAX_ATTEMPTS) {
    await failJob(job, job.problem ?? STOPPED_PROBLEM);
    return { ok: false, reason: "stopped" };
  }
  return { ok: true, job };
}

/** Lets go of a job, to be taken up again by the next run. A reason (storage was down) is kept for the job's failure. */
export async function releaseJob(job: Pick<DataJob, "id" | "storeId">, problem: string | null = null): Promise<void> {
  await db().execute(sql`update commerce.data_jobs set claimed_until = null, problem = coalesce(${problem}, problem) where store_id = ${job.storeId}::uuid and id = ${job.id}::uuid and status in ('checking', 'queued', 'running')`);
}

export type Progress = {
  phase?: JobPhase | null;
  cursor?: Record<string, unknown>;
  counts?: Record<string, unknown>;
  rowsDone?: number | null;
  rowsTotal?: number | null;
  files?: DataJobFile[];
};

/** Saves where a run got to; a job that moves has its attempts back at one. Only while the job is still running (a cancelled one is left as it is). */
export async function saveProgress(job: Pick<DataJob, "id" | "storeId">, p: Progress): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set phase = ${p.phase === undefined ? sql`phase` : sql`${p.phase}`},
           cursor = ${p.cursor === undefined ? sql`cursor` : sql`${JSON.stringify(p.cursor)}::jsonb`},
           counts = ${p.counts === undefined ? sql`counts` : sql`${JSON.stringify(p.counts)}::jsonb`},
           rows_done = ${p.rowsDone === undefined ? sql`rows_done` : sql`${p.rowsDone}`},
           rows_total = ${p.rowsTotal === undefined ? sql`rows_total` : sql`${p.rowsTotal}`},
           files = ${p.files === undefined ? sql`files` : sql`${JSON.stringify(p.files)}::jsonb`},
           problem = null, attempts = 1
     where store_id = ${job.storeId}::uuid and id = ${job.id}::uuid and status in ('checking', 'running')
    returning id
  `);
  return rows.length > 0;
}

/** Whether a job is still one to work on (a person may have cancelled it between two chunks). */
export async function stillRunning(job: Pick<DataJob, "id" | "storeId">): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select status from commerce.data_jobs where store_id = ${job.storeId}::uuid and id = ${job.id}::uuid`);
  return row !== undefined && ["checking", "running"].includes(String(row.status));
}

export type Ending = { status: "done" | "checked"; counts?: Record<string, unknown>; cursor?: Record<string, unknown>; files?: DataJobFile[]; rowsDone?: number | null; rowsTotal?: number | null; keepDays?: number; phase?: JobPhase | null };

/** Ends a run's work: an export (or an applied import) is `done`, a checked import is `checked`. False when the job was cancelled meanwhile. */
export async function finishJob(job: Pick<DataJob, "id" | "storeId" | "kind">, end: Ending): Promise<boolean> {
  const done = end.status === "done";
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = ${end.status}, claimed_until = null, attempts = 0,
           phase = ${end.phase === undefined ? sql`phase` : sql`${end.phase}`},
           counts = ${end.counts === undefined ? sql`counts` : sql`${JSON.stringify(end.counts)}::jsonb`},
           cursor = ${end.cursor === undefined ? sql`cursor` : sql`${JSON.stringify(end.cursor)}::jsonb`},
           files = ${end.files === undefined ? sql`files` : sql`${JSON.stringify(end.files)}::jsonb`},
           rows_done = ${end.rowsDone === undefined ? sql`rows_done` : sql`${end.rowsDone}`},
           rows_total = ${end.rowsTotal === undefined ? sql`rows_total` : sql`${end.rowsTotal}`},
           expires_at = ${done ? sql`now() + make_interval(days => ${end.keepDays ?? 7})` : sql`expires_at`}
     where store_id = ${job.storeId}::uuid and id = ${job.id}::uuid and status in ('checking', 'running')
    returning id
  `);
  return rows.length > 0;
}

/** Stops a job for good with a plain reason, keeping what it wrote. A job that has ended is left as it is. */
export async function failJob(job: Pick<DataJob, "id" | "storeId">, problem: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = 'failed', problem = ${problem.slice(0, 500)}, claimed_until = null
     where store_id = ${job.storeId}::uuid and id = ${job.id}::uuid and status in ('uploaded', 'checking', 'checked', 'queued', 'running')
    returning id
  `);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Items and assets
// ---------------------------------------------------------------------------

export type ItemInput = {
  seq: number;
  kind: "product" | "redirect" | "file";
  ref: string | null;
  rows: number[];
  outcome: ItemOutcome;
  messages: Finding[];
  changes: Record<string, unknown>;
};

/** Writes items by `(job, seq)`: a resumed run writes each once. */
export async function putItems(job: Pick<DataJob, "id" | "storeId">, items: readonly ItemInput[]): Promise<void> {
  if (items.length === 0) return;
  for (let start = 0; start < items.length; start += 200) {
    const part = items.slice(start, start + 200);
    const values = part.map(
      (i) => sql`(${job.storeId}::uuid, ${job.id}::uuid, ${i.seq}, ${i.kind}, ${i.ref}, ${`{${[...new Set(i.rows)].join(String.fromCharCode(44))}}`}::int[], ${i.outcome}, ${JSON.stringify(i.messages)}::jsonb, ${JSON.stringify(i.changes)}::jsonb)`,
    );
    await db().execute(sql`
      insert into commerce.data_job_items (store_id, job_id, seq, kind, ref, rows, outcome, messages, changes)
      values ${sql.join(values, sql`, `)}
      on conflict (job_id, seq) do update
        set kind = excluded.kind, ref = excluded.ref, rows = excluded.rows, outcome = excluded.outcome, messages = excluded.messages, changes = excluded.changes
    `);
  }
}

export type StoredItem = ItemInput & { createdAt: string };

/** A job's items in order, optionally one outcome or severity, a page at a time (every query carries the store id). */
export async function listItems(storeId: string, jobId: string, opts: { severity?: "error" | "warning" | "info"; offset?: number; limit?: number } = {}): Promise<{ items: StoredItem[]; total: number }> {
  if (!isJobId(jobId)) return { items: [], total: 0 };
  const severity = opts.severity
    ? sql`and exists (select 1 from jsonb_array_elements(messages) m where m ->> 'severity' = ${opts.severity})`
    : sql``;
  const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.data_job_items where store_id = ${storeId}::uuid and job_id = ${jobId}::uuid ${severity}`);
  const rows = await db().execute<Row>(sql`
    select seq, kind, ref, rows, outcome, messages, changes, created_at from commerce.data_job_items
    where store_id = ${storeId}::uuid and job_id = ${jobId}::uuid ${severity}
    order by seq offset ${Math.max(0, opts.offset ?? 0)} limit ${Math.min(Math.max(1, opts.limit ?? 100), 500)}
  `);
  return {
    total: Number(count?.n ?? 0),
    items: rows.map((r) => ({
      seq: Number(r.seq),
      kind: String(r.kind) as "product" | "redirect" | "file",
      ref: r.ref ? String(r.ref) : null,
      rows: ((r.rows ?? []) as number[]).map(Number),
      outcome: String(r.outcome) as ItemOutcome,
      messages: (Array.isArray(r.messages) ? r.messages : []) as Finding[],
      changes: obj(r.changes),
      createdAt: iso(r.created_at) ?? "",
    })),
  };
}

export type AssetRow = { libraryUrl: string | null; reason: string | null };

/** The pictures of a job already fetched, by the address in the file. */
export async function assetsOf(job: Pick<DataJob, "id" | "storeId">, urls: readonly string[]): Promise<Map<string, AssetRow>> {
  if (urls.length === 0) return new Map();
  const rows = await db().execute<Row>(sql`
    select source_url, library_url, reason from commerce.data_job_assets
    where store_id = ${job.storeId}::uuid and job_id = ${job.id}::uuid and source_url = any(${pgTextArray(urls)}::text[])
  `);
  return new Map(rows.map((r) => [String(r.source_url), { libraryUrl: r.library_url ? String(r.library_url) : null, reason: r.reason ? String(r.reason) : null }]));
}

export async function putAsset(job: Pick<DataJob, "id" | "storeId">, sourceUrl: string, result: { libraryUrl: string } | { reason: string }): Promise<void> {
  const library = "libraryUrl" in result ? result.libraryUrl : null;
  const reason = "reason" in result ? result.reason.slice(0, 300) : null;
  await db().execute(sql`
    insert into commerce.data_job_assets (store_id, job_id, source_url, library_url, reason)
    values (${job.storeId}::uuid, ${job.id}::uuid, ${sourceUrl}, ${library}, ${reason})
    on conflict (job_id, source_url) do update set library_url = excluded.library_url, reason = excluded.reason
  `);
}

// ---------------------------------------------------------------------------
// The two private buckets
// ---------------------------------------------------------------------------

/**
 * The files of data jobs: a signed upload for the browser (an import's file), and read, write, remove and a short-lived signed address for the
 * server (with the secret key, like `documentStorage()`). Both buckets are private; no policy lets a browser read them.
 */
export type StorageEntry = { name: string; isFolder: boolean };

export type DataStorage = {
  /** A signed upload for one new path of the imports bucket. */
  signedUpload(path: string): Promise<{ token: string } | null>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<boolean>;
  download(bucket: string, path: string): Promise<Uint8Array | null>;
  remove(bucket: string, paths: string[]): Promise<boolean>;
  /** What is directly under a folder of a bucket (the bucket's root with an empty folder): files and sub-folders. Null when storage did not answer. */
  list(bucket: string, folder: string): Promise<StorageEntry[] | null>;
  signedUrl(bucket: string, path: string, name: string, seconds: number): Promise<string | null>;
};

export function dataStorage(): DataStorage | null {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key || supabaseKeyKind(key) === "publishable") return null;
  let url: string;
  try {
    url = publicEnv().NEXT_PUBLIC_SUPABASE_URL;
  } catch {
    return null;
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const known = (bucket: string) => bucket === IMPORTS_BUCKET || bucket === EXPORTS_BUCKET;
  return {
    async signedUpload(path) {
      const { data, error } = await client.storage.from(IMPORTS_BUCKET).createSignedUploadUrl(path);
      if (error || !data) {
        console.error("[data-jobs] an upload could not be started:", error?.message);
        return null;
      }
      return { token: data.token };
    },
    async upload(bucket, path, bytes, contentType) {
      if (!known(bucket)) return false;
      const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, cacheControl: "0", upsert: true });
      if (error) console.error("[data-jobs] a file could not be stored:", error.message);
      return !error;
    },
    async download(bucket, path) {
      if (!known(bucket)) return null;
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(bucket, paths) {
      if (!known(bucket)) return false;
      if (paths.length === 0) return true;
      const { error } = await client.storage.from(bucket).remove(paths);
      if (error) console.error("[data-jobs] files could not be removed:", error.message);
      return !error;
    },
    async list(bucket, folder) {
      if (!known(bucket)) return null;
      const out: StorageEntry[] = [];
      for (let offset = 0; offset < 100_000; offset += 1000) {
        const { data, error } = await client.storage.from(bucket).list(folder, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
        if (error || !data) {
          if (error) console.error("[data-jobs] files could not be listed:", error.message);
          return null;
        }
        out.push(...data.map((d) => ({ name: d.name, isFolder: d.id === null })));
        if (data.length < 1000) break;
      }
      return out;
    },
    async signedUrl(bucket, path, name, seconds) {
      if (!known(bucket)) return null;
      const { data, error } = await client.storage.from(bucket).createSignedUrl(path, seconds, { download: name });
      if (error || !data) return null;
      return data.signedUrl;
    },
  };
}

/** What a run reaches outside the database, replaceable in tests. */
export type DataDeps = {
  /** The private buckets; null where this server has none. */
  storage?: DataStorage | null;
  /** Starts a job after the response; the five-minute job takes it up where that is not possible. */
  schedule?: (run: () => Promise<unknown>) => void;
  /** How long one run may work, in ms. */
  budgetMs?: number;
  /** A product's pictures from other websites (`safeFetch()`), a picture saved in the library, and the saving of the reply. */
  fetchPicture?: (url: string) => Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; problem: string }>;
  storePicture?: (owner: { storeId: string; accountId: string }, image: File, thumbnail: File, details: { fileName: string }) => Promise<{ ok: true; url: string; thumbnailUrl: string } | { ok: false; problem: string }>;
  /** The email that tells a member a file is ready. */
  send?: typeof import("./email").sendEmail;
  /** Rows of an export read in one go; small in tests to make a job of a few rows. */
  batchRows?: number;
  /** An export's rows per part; small in tests. */
  partRows?: number;
  /** The product (or redirect line) an import stops at in a test (a run that is killed): the run throws after this many. */
  stopAfter?: number;
  /** Lines of a redirect import read, planned and written together; small in tests to make a file of a few lines several chunks (the real figure is `REDIRECT_APPLY_CHUNK`). */
  chunkRows?: number;
};

/** Runs a job after the response (`after()`); where that is not possible (no request) the five-minute job takes it up. `deps.schedule` replaces it in tests. */
export function scheduleJob(deps: DataDeps, run: () => Promise<unknown>): void {
  if (deps.schedule) return deps.schedule(run);
  void import("next/server")
    .then(({ after }) => {
      try {
        after(run);
      } catch {
        // Not in a request: the five-minute job takes the job up.
      }
    })
    .catch(() => undefined);
}

export const storageOf = (deps: DataDeps): DataStorage | null => (deps.storage === undefined ? dataStorage() : deps.storage);

export const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A file name safe for a path and for a Content-Disposition header: letters, digits, dots, hyphens and underscores. */
export function safeName(name: string, fallback = "file.csv"): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(-100) || fallback;
}

/** An import's path in the imports bucket: `{store}/{uuid}/{safe name}`, and nothing else. */
export const importPathPattern = (storeId: string): RegExp => new RegExp(`^${storeId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,120}$`);

/** An export's part path: `{store}/{job}/part-{n}.csv`; a chunk of one before it is assembled: `{store}/{job}/chunk-{n}.csv`. */
export const partPath = (storeId: string, jobId: string, n: number): string => `${storeId}/${jobId}/part-${n}.csv`;
export const chunkPath = (storeId: string, jobId: string, n: number): string => `${storeId}/${jobId}/chunk-${String(n).padStart(6, "0")}.csv`;

/**
 * Every file an export has in its bucket, found by LISTING its folder `{store}/{job}/` and not by trusting what the job's row says: a run writes a file a
 * moment before it records it, so a cancelled or erased job can have a file no row names. Null when storage did not answer (the caller does not go on as
 * if nothing was there).
 */
export async function exportFolderFiles(storage: DataStorage, storeId: string, jobId: string): Promise<string[] | null> {
  const folder = `${storeId}/${jobId}`;
  const entries = await storage.list(EXPORTS_BUCKET, folder);
  return entries === null ? null : entries.filter((e) => !e.isFolder).map((e) => `${folder}/${e.name}`);
}

/** The job's row the member's request is about, from the store's own query only. Used for a cheap "is this job mine" check. */
export async function jobBelongs(storeId: string, id: string): Promise<boolean> {
  return (await getJob(storeId, id)) !== null;
}
