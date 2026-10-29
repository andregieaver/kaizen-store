import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parseCsv, unescapeText, writeCsv, type Cell } from "@/lib/csv";
import { checkHeader, duplicateFlags, headerNotes, parseCustomerRow, readHeader, tooManyRows, type HeaderIndex, type ParsedCustomer } from "@/lib/customer-import";
import { EMPTY_COUNTS, finding, summariseCounts, type Finding, type ItemOutcome, type ItemSummary, type JobCounts } from "@/lib/data-job";
import { IMPORT_MAX_BYTES, INVENTORY_APPLY_CHUNK } from "@/lib/data-limits";
import type { FileFinding } from "@/lib/product-csv";
import { TAGS_PER_PERSON } from "@/lib/segments";

import { audit, type Membership } from "./auth";
import { createCustomerIn, customerByEmail, updateCustomerIn, type CustomerPatch } from "./customer-staff";
import { JobStopped } from "./data-export-run";
import {
  IMPORTS_BUCKET,
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
import { log } from "./log";
import { NO_ACCESS, memberCan } from "./permissions";
import { tagIn } from "./segments";

type Row = Record<string, unknown>;

/**
 * Customers by file (wave 10 unit C, D366): the `customer_import` kind of the D165 jobs, on the same pipeline as the stock file, never a
 * second one. A row is one person by their email: a person the store has is changed (only the details the row gives; an empty cell keeps
 * what the store has), anyone else is added as an account with no password, and the row's tags are added (never one taken away). Every
 * write goes through staff's own writer (`createCustomerIn()`, `updateCustomerIn()`, `tagIn()`), so a row and the form follow the same
 * rules. The import never subscribes anyone to marketing email, never sets a password and never touches an order. The dry run reads every
 * row and writes nothing; the apply writes each row on its own transaction, judged again then. A finding names a column, never a cell;
 * an item's reference is null, never the address. Owners only (`JOB_KEY`), as the customer file is; one audit entry when it starts and one
 * when it ends, counts only.
 */

const KEY = "owner" as const;

// ---------------------------------------------------------------------------
// Reading a file
// ---------------------------------------------------------------------------

type FileRow = { row: number; cells: string[] };
type ReadFile = { ok: true; index: HeaderIndex; rows: FileRow[]; findings: FileFinding[] } | { ok: false; problems: string[] };

/** A file's bytes into rows, or why it is refused: empty, too large or too long, ending inside a quoted cell, or without an `email` column. */
export function readCustomerFile(bytes: Uint8Array): ReadFile {
  if (bytes.length === 0) return { ok: false, problems: [finding("file.empty").text] };
  if (bytes.length > IMPORT_MAX_BYTES) return { ok: false, problems: [finding("file.too_large", { max: Math.floor(IMPORT_MAX_BYTES / 1024 / 1024) }).text] };
  const parsed = parseCsv(bytes);
  if (parsed.unterminated) return { ok: false, problems: ["The file ends inside a quoted cell. Check the quotes and try again."] };
  if (parsed.rows.length === 0) return { ok: false, problems: [finding("file.empty").text] };
  const index = readHeader(parsed.rows[0]);
  const refused = checkHeader(index);
  if (refused) return { ok: false, problems: [refused.text] };
  const many = tooManyRows(parsed.rows.length - 1);
  if (many) return { ok: false, problems: [many.text] };
  const findings: FileFinding[] = headerNotes(parsed.rows[0]).map((f) => ({ rows: [1], finding: f }));
  if (parsed.assumed) findings.push({ rows: [], finding: finding("file.encoding_assumed") });
  for (const row of parsed.ragged.slice(0, 50)) findings.push({ rows: [row], finding: finding("file.ragged_row") });
  const rows: FileRow[] = [];
  parsed.rows.slice(1).forEach((cells, i) => {
    if (cells.every((c) => unescapeText(c).trim() === "")) return;
    rows.push({ row: i + 2, cells });
  });
  return { ok: true, index, rows, findings };
}

// ---------------------------------------------------------------------------
// Upload and register
// ---------------------------------------------------------------------------

export type UploadStart = { ok: true; path: string; token: string; bucket: typeof IMPORTS_BUCKET } | { ok: false; problem: string };

/** A signed upload for the browser: one new path in the store's folder of the private imports bucket. */
export async function startCustomerUpload(member: Membership, fileName: string, deps: DataDeps = {}): Promise<UploadStart> {
  if (!memberCan(member, KEY)) return { ok: false, problem: NO_ACCESS };
  const storage = storageOf(deps);
  if (!storage) return { ok: false, problem: "Uploads are not set up on this server." };
  const path = `${member.store.id}/${randomUUID()}/${safeName(fileName, "customers.csv")}`;
  const started = await storage.signedUpload(path);
  if (!started) return { ok: false, problem: "The upload could not be started. Try again." };
  return { ok: true, path, token: started.token, bucket: IMPORTS_BUCKET };
}

export type RegisterResult = { ok: true; jobId: string; rows: number } | { ok: false; problems: string[] };

const isUniqueViolation = (error: unknown): boolean => {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
};

const shownName = (name: string): string => name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[/\\]/g, "-").trim().slice(0, 120) || "customers.csv";

/** Registers a file the browser uploaded: read, refused with a sentence (and removed), or kept as a job in `uploaded`. One customer import is open per store. */
export async function registerCustomerImport(member: Membership, input: { path: string; name: string }, deps: DataDeps = {}): Promise<RegisterResult> {
  if (!memberCan(member, KEY)) return { ok: false, problems: [NO_ACCESS] };
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
  const read = readCustomerFile(bytes);
  if (!read.ok) return refuse(read.problems);
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.data_jobs (store_id, kind, status, format, requested_by, input_path, input_name, input_bytes, input_sha256, rows_total)
      values (${storeId}::uuid, 'customer_import', 'uploaded', 'kaizen', ${member.account.id}::uuid, ${input.path}, ${shownName(input.name)}, ${bytes.length}, ${sha256Of(bytes)}, ${read.rows.length})
      returning id
    `);
    return { ok: true, jobId: String(row.id), rows: read.rows.length };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return refuse(["Another customer import is open for this store. Finish it or cancel it first."]);
  }
}

// ---------------------------------------------------------------------------
// Check and apply: starting them
// ---------------------------------------------------------------------------

export type StepResult = { ok: true } | { ok: false; problem: string };

/** Starts (or restarts) the dry run of an uploaded or checked customer import: it writes nothing about anyone. */
export async function checkCustomerImport(member: Membership, jobId: string, run: (id: string) => Promise<unknown>, deps: DataDeps = {}): Promise<StepResult> {
  if (!memberCan(member, KEY)) return { ok: false, problem: NO_ACCESS };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== "customer_import") return { ok: false, problem: "This import could not be found." };
  if (job.status !== "uploaded" && job.status !== "checked") return { ok: false, problem: job.status === "checking" ? "The file is being checked." : "This import can no longer be checked." };
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = 'checking', phase = 'check', options = '{}'::jsonb, cursor = '{}'::jsonb, counts = '{}'::jsonb,
           rows_done = null, rows_total = null, attempts = 0, claimed_until = null, problem = null
     where store_id = ${member.store.id}::uuid and id = ${job.id}::uuid and kind = 'customer_import' and status in ('uploaded', 'checked')
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "This import can no longer be checked." };
  await db().execute(sql`delete from commerce.data_job_items where store_id = ${member.store.id}::uuid and job_id = ${job.id}::uuid`);
  scheduleJob(deps, () => run(job.id));
  return { ok: true };
}

export type CustomerDry = { toCreate: number; toUpdate: number; withProblems: number };

/** The numbers a checked job shows before it is applied. */
export const customerDryCountsOf = (job: Pick<DataJob, "counts">): CustomerDry => {
  const d = (job.counts.dry ?? {}) as Record<string, unknown>;
  return { toCreate: Number(d.toCreate ?? 0), toUpdate: Number(d.toUpdate ?? 0), withProblems: Number(d.withProblems ?? 0) };
};

/** Starts the apply of a checked import; the start is written to the activity log first (counts only), and an import whose entry cannot be written does not start. */
export async function applyCustomerImport(member: Membership, jobId: string, run: (id: string) => Promise<unknown>, deps: DataDeps = {}): Promise<StepResult> {
  if (!memberCan(member, KEY)) return { ok: false, problem: NO_ACCESS };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== "customer_import") return { ok: false, problem: "This import could not be found." };
  if (job.status !== "checked") return { ok: false, problem: "Check the file first." };
  const dry = customerDryCountsOf(job);
  if (dry.toCreate + dry.toUpdate === 0) return { ok: false, problem: "No row of this file can be imported. Fix the problems the check found and check it again." };
  try {
    await audit(member.account.id, member.store.id, "customer.import_started", { job: job.id, rows: job.rowsTotal, toCreate: dry.toCreate, toUpdate: dry.toUpdate }, { area: "customers", target: { type: "data_job", id: job.id } });
  } catch (error) {
    log("error", "customer_import.start_audit_failed", {}, error);
    return { ok: false, problem: "The activity log could not be written, so the import was not started. Try again." };
  }
  const files = Number((job.cursor as { files?: unknown }).files ?? 0);
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = 'queued', phase = 'apply', cursor = ${JSON.stringify({ next: 0, files })}::jsonb, counts = ${JSON.stringify({ ...EMPTY_COUNTS, dry })}::jsonb,
           rows_done = 0, attempts = 0, claimed_until = null, problem = null
     where store_id = ${member.store.id}::uuid and id = ${job.id}::uuid and kind = 'customer_import' and status = 'checked'
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "Check the file first." };
  scheduleJob(deps, () => run(job.id));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Judging a row
// ---------------------------------------------------------------------------

type Prepared = {
  storeId: string;
  rows: FileRow[];
  fileFindings: FileFinding[];
  parsed: { row: ParsedCustomer | null; findings: Finding[] }[];
  duplicates: boolean[];
};

/** The store's own country: an organisation number without an address is read by its rule. */
async function homeCountryOf(storeId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`select upper(country) as country from commerce.stores where id = ${storeId}::uuid`);
  return row?.country ? String(row.country) : null;
}

/** The file of a run, read again at the start of EVERY run and held to the SHA-256 it was registered with: an apply is of the file that was checked. */
async function prepare(job: DataJob, deps: DataDeps): Promise<Prepared> {
  const storage = storageOf(deps);
  if (!storage || !job.inputPath) throw new StorageDown();
  const bytes = await storage.download(IMPORTS_BUCKET, job.inputPath);
  if (!bytes) throw new StorageDown();
  if (sha256Of(bytes) !== job.inputSha256) throw new JobStopped("The file is not the one that was checked. Upload it again.");
  const read = readCustomerFile(bytes);
  if (!read.ok) throw new JobStopped(read.problems[0]);
  const home = await homeCountryOf(job.storeId);
  const parsed = read.rows.map((r) => parseCustomerRow(r.cells, read.index, home));
  return { storeId: job.storeId, rows: read.rows, fileFindings: read.findings, parsed, duplicates: duplicateFlags(parsed.map((p) => p.row)) };
}

type Judged = { findings: Finding[]; action: "skip" | "create" | "update"; row: ParsedCustomer | null };

/** The emails of a chunk that are customers of the store already. */
async function knownEmails(storeId: string, emails: readonly string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await db().execute<Row>(sql`
    select lower(email) as email from commerce.customers
    where store_id = ${storeId}::uuid and lower(email) in (${sql.join(emails.map((e) => sql`${e}`), sql`, `)})
  `);
  return new Set(rows.map((r) => String(r.email)));
}

async function judge(p: Prepared, at: number, count: number): Promise<Judged[]> {
  const slice = p.parsed.slice(at, at + count);
  const known = await knownEmails(p.storeId, slice.flatMap((x) => (x.row ? [x.row.email] : [])));
  return slice.map((x, i): Judged => {
    if (!x.row) return { findings: x.findings, action: "skip", row: null };
    if (p.duplicates[at + i]) return { findings: [...x.findings, finding("customerfile.duplicate", { column: "email" })], action: "skip", row: x.row };
    return { findings: x.findings, action: known.has(x.row.email) ? "update" : "create", row: x.row };
  });
}

const hasError = (findings: readonly Finding[]) => findings.some((f) => f.severity === "error");

/** A judged row as the item the page lists: no reference (an email is a person's data), its row, what an apply does. */
function itemOf(seq: number, rowNumber: number, j: Judged, dry: boolean): ItemInput {
  const outcome: ItemOutcome = dry ? "checked" : j.action === "create" ? "created" : j.action === "update" ? "updated" : "skipped";
  return { seq, kind: "customer", ref: null, rows: [rowNumber], outcome: hasError(j.findings) && !dry ? "failed" : outcome, messages: j.findings, changes: { will: j.action === "create" ? "created" : j.action === "update" ? "updated" : "skipped" } };
}

// ---------------------------------------------------------------------------
// The check: a dry run
// ---------------------------------------------------------------------------

type CheckCursor = { next: number; files: number; filesWritten: boolean; dry: CustomerDry; warnings: number; errors: number };

const checkCursor = (job: DataJob): CheckCursor => {
  const c = job.cursor as Partial<CheckCursor>;
  const d = (c.dry ?? {}) as Partial<CustomerDry>;
  return {
    next: Number(c.next ?? 0),
    files: Number(c.files ?? 0),
    filesWritten: c.filesWritten === true,
    dry: { toCreate: Number(d.toCreate ?? 0), toUpdate: Number(d.toUpdate ?? 0), withProblems: Number(d.withProblems ?? 0) },
    warnings: Number(c.warnings ?? 0),
    errors: Number(c.errors ?? 0),
  };
};

const chunkOf = (deps: DataDeps): number => Math.max(1, deps.chunkRows ?? INVENTORY_APPLY_CHUNK);

/** One run of a dry run: judges the rows chunk by chunk, writing an item for each and nothing about anyone. */
export async function runCustomerCheck(job: DataJob, deps: DataDeps, until: number): Promise<"checked" | "paused"> {
  const p = await prepare(job, deps);
  const cursor = checkCursor(job);
  const total = p.rows.length;
  if (!cursor.filesWritten) {
    await putItems(job, p.fileFindings.map((f, i): ItemInput => ({ seq: i, kind: "file", ref: null, rows: f.rows, outcome: "checked", messages: [f.finding], changes: {} })));
    cursor.files = p.fileFindings.length;
    cursor.filesWritten = true;
    cursor.errors = p.fileFindings.filter((f) => f.finding.severity === "error").length;
    cursor.warnings = p.fileFindings.filter((f) => f.finding.severity === "warning").length;
    if (!(await saveProgress(job, { cursor: { ...cursor }, rowsTotal: total, rowsDone: cursor.next }))) return "paused";
  }
  const size = chunkOf(deps);
  while (cursor.next < total) {
    if (Date.now() >= until) return "paused";
    const judged = await judge(p, cursor.next, size);
    const items = judged.map((j, i) => {
      for (const f of j.findings) {
        if (f.severity === "error") cursor.errors += 1;
        if (f.severity === "warning") cursor.warnings += 1;
      }
      if (j.action === "create") cursor.dry.toCreate += 1;
      else if (j.action === "update") cursor.dry.toUpdate += 1;
      else cursor.dry.withProblems += 1;
      return itemOf(cursor.files + cursor.next + i, p.rows[cursor.next + i].row, j, true);
    });
    await putItems(job, items);
    cursor.next += judged.length;
    if (!(await saveProgress(job, { cursor: { ...cursor }, rowsDone: cursor.next }))) return "paused";
    if (!(await stillRunning(job))) return "paused";
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

/** The details a row gives, laid over the person's: an empty cell is left out of the patch, so it keeps what the store has. */
const patchOf = (row: ParsedCustomer): CustomerPatch => ({
  ...(row.name !== null ? { name: row.name } : {}),
  ...(row.phone !== null ? { phone: row.phone } : {}),
  ...(row.address ? { address: row.address } : {}),
  ...(row.company ? { company: row.company } : {}),
});

/** A refusal inside a row's transaction, carrying the finding the row is skipped with. */
class RowRefused extends Error {
  constructor(readonly found: Finding) {
    super("customer_import.row");
  }
}

/** One row, on its own transaction, judged again here (another row or a person may have taken the address since the dry run). */
async function writeRow(job: DataJob, p: Prepared, i: number): Promise<Judged> {
  const [first] = await judge(p, i, 1);
  if (first.action === "skip" || !first.row) return first;
  const row = first.row;
  try {
    return await db().transaction(async (tx): Promise<Judged> => {
      const existing = await customerByEmail(tx, job.storeId, row.email);
      if (existing) {
        const done = await updateCustomerIn(tx, job.storeId, existing, patchOf(row));
        if (!done.ok) throw new RowRefused(finding("customerfile.failed"));
      } else {
        const made = await createCustomerIn(tx, job.storeId, {
          email: row.email,
          name: row.name ?? "",
          phone: row.phone ?? "",
          address: row.address,
          company: row.company,
        });
        if (!made.ok) throw new RowRefused(finding("customerfile.failed"));
      }
      const tagged = await tagIn(tx, job.storeId, job.requestedBy, row.email, row.tags);
      const findings = tagged.full ? [...first.findings, finding("customerfile.tags_full", { column: "tags", max: TAGS_PER_PERSON })] : first.findings;
      return { findings, action: existing ? "update" : "create", row };
    });
  } catch (error) {
    if (error instanceof RowRefused) return { ...first, action: "skip", findings: [...first.findings, error.found] };
    log("error", "customer_import.row_save_failed", {}, error);
    return { ...first, action: "skip", findings: [...first.findings, finding("customerfile.failed")] };
  }
}

/** One run of an apply: row by row, the items and counts saved after each chunk, the cursor kept so a run that was killed goes on where it was. */
export async function runCustomerApply(job: DataJob, deps: DataDeps, until: number): Promise<"done" | "paused"> {
  const p = await prepare(job, deps);
  const cursor = applyCursor(job);
  const total = p.rows.length;
  const dry = (job.counts.dry ?? {}) as Record<string, unknown>;
  let counts: JobCounts = { ...EMPTY_COUNTS, ...(Object.fromEntries(Object.entries(job.counts).filter(([k]) => k in EMPTY_COUNTS)) as Partial<JobCounts>) };
  let processed = 0;
  const size = chunkOf(deps);
  while (cursor.next < total) {
    if (Date.now() >= until) break;
    const end = Math.min(cursor.next + size, total);
    const items: ItemInput[] = [];
    const summaries: ItemSummary[] = [];
    for (let i = cursor.next; i < end; i += 1) {
      const j = await writeRow(job, p, i);
      summaries.push({ outcome: j.action === "create" ? "created" : j.action === "update" ? "updated" : hasError(j.findings) ? "failed" : "skipped", messages: j.findings });
      items.push(itemOf(cursor.files + i, p.rows[i].row, j, false));
      processed += 1;
      if (deps.stopAfter !== undefined && processed >= deps.stopAfter) throw new Error("the run was stopped (test)");
    }
    await putItems(job, items);
    const add = summariseCounts(summaries);
    counts = Object.fromEntries(Object.keys(EMPTY_COUNTS).map((k) => [k, (counts as Record<string, number>)[k] + (add as Record<string, number>)[k]])) as JobCounts;
    cursor.next = end;
    if (!(await saveProgress(job, { cursor: { ...cursor }, counts: { ...counts, dry }, rowsDone: cursor.next, rowsTotal: total }))) return "paused";
    if (!(await stillRunning(job))) return "paused";
  }
  if (cursor.next < total) return "paused";
  const ended = await finishJob(job, { status: "done", counts: { ...counts, dry }, cursor: { ...cursor }, rowsDone: total, rowsTotal: total, phase: "apply", keepDays: 30 });
  if (!ended) return "paused";
  await audit(job.requestedBy, job.storeId, "customer.imported", { job: job.id, rows: total, created: counts.created, updated: counts.updated, skipped: counts.skipped, failed: counts.failed }, { area: "customers", target: { type: "data_job", id: job.id } }).catch((error) =>
    log("error", "customer_import.end_audit_failed", {}, error),
  );
  return "done";
}

// ---------------------------------------------------------------------------
// The problems as a file
// ---------------------------------------------------------------------------

/** The findings of a customer import as a CSV (row, severity, code, column, message), through the one writer; never a cell of the file. Owners. */
export async function customerProblemsCsv(member: Membership, jobId: string): Promise<{ ok: true; filename: string; csv: string } | { ok: false }> {
  if (!memberCan(member, KEY)) return { ok: false };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== "customer_import") return { ok: false };
  const rows: Cell[][] = [["row", "severity", "code", "column", "message"]];
  for (let offset = 0; offset < 200_000; offset += 500) {
    const page = await listItems(member.store.id, job.id, { offset, limit: 500 });
    for (const item of page.items) for (const m of item.messages) rows.push([item.rows[0] ?? null, m.severity, m.code, m.column ?? null, m.text]);
    if (page.items.length < 500) break;
  }
  return { ok: true, filename: `customer-import-problems-${new Date().toISOString().slice(0, 10)}.csv`, csv: writeCsv(rows, "standard") };
}
