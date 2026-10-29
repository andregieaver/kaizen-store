import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parseCsv, writeCsv, type Cell } from "@/lib/csv";
import { EMPTY_COUNTS, finding, summariseCounts, type Finding, type ItemOutcome, type ItemSummary, type JobCounts } from "@/lib/data-job";
import { IMPORT_MAX_BYTES, INVENTORY_APPLY_CHUNK } from "@/lib/data-limits";
import { HISTORY_ORDERS_MAX, PROBLEM_WORDS, historyNumber, isShopifyOrders, readShopifyOrders, type HistoryOrder, type HistoryProblem } from "@/lib/order-history";

import { audit, type Membership } from "./auth";
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
import { insertHistoryOrder } from "./order-insert";
import { NO_ACCESS, memberCan } from "./permissions";

type Row = Record<string, unknown>;

/**
 * An order history from another shop (wave 11 unit E, D384): the `order_history_import` kind of the D165 jobs, on the pipeline the customer
 * import uses. Shopify's order export is read by `readShopifyOrders()` and each order becomes a COPIED order (`C-{name}`, `copied_from` a
 * key made from the store and the order's name, D129), inserted only by `insertHistoryOrder()` in `order-insert.ts`: history, never paid,
 * refunded, shipped, emailed, invoiced or counted in revenue, in the file's own currency and amounts. An order is tied to a customer only when
 * the store already has one with the order's email (the customer import makes them); nobody is made, subscribed or emailed. The dry run
 * writes nothing; the apply writes each order in its own transaction, and an order already imported is left as it is. Owners only, as the
 * order file is (D165); an item's reference is the order's name in the old shop, never an address; one audit entry at the start and one at
 * the end, counts only.
 */

const KEY = "owner" as const;
const KIND = "order_history_import" as const;

type ReadFile = { ok: true; orders: HistoryOrder[]; problems: HistoryProblem[] } | { ok: false; problems: string[] };

/** A file's bytes as orders, or why it is refused: empty, too large, not Shopify's order export, or more orders than one import takes. */
export function readHistoryFile(bytes: Uint8Array): ReadFile {
  if (bytes.length === 0) return { ok: false, problems: [finding("file.empty").text] };
  if (bytes.length > IMPORT_MAX_BYTES) return { ok: false, problems: [finding("file.too_large", { max: Math.floor(IMPORT_MAX_BYTES / 1024 / 1024) }).text] };
  const parsed = parseCsv(bytes);
  if (parsed.unterminated) return { ok: false, problems: ["The file ends inside a quoted cell. Check the quotes and try again."] };
  if (parsed.rows.length === 0) return { ok: false, problems: [finding("file.empty").text] };
  if (!isShopifyOrders(parsed.rows[0])) return { ok: false, problems: ["This is not Shopify's order export: it needs the Name, Financial Status and Lineitem quantity columns."] };
  const read = readShopifyOrders(parsed.rows);
  if (read.orders.length + read.problems.length > HISTORY_ORDERS_MAX) return { ok: false, problems: [`The file has more than ${HISTORY_ORDERS_MAX.toLocaleString("en-GB")} orders. Split it and import the parts one after another.`] };
  return { ok: true, ...read };
}

export type UploadStart = { ok: true; path: string; token: string; bucket: typeof IMPORTS_BUCKET } | { ok: false; problem: string };

/** A signed upload for the browser: one new path in the store's folder of the private imports bucket. */
export async function startHistoryUpload(member: Membership, fileName: string, deps: DataDeps = {}): Promise<UploadStart> {
  if (!memberCan(member, KEY)) return { ok: false, problem: NO_ACCESS };
  const storage = storageOf(deps);
  if (!storage) return { ok: false, problem: "Uploads are not set up on this server." };
  const path = `${member.store.id}/${randomUUID()}/${safeName(fileName, "orders.csv")}`;
  const started = await storage.signedUpload(path);
  if (!started) return { ok: false, problem: "The upload could not be started. Try again." };
  return { ok: true, path, token: started.token, bucket: IMPORTS_BUCKET };
}

export type RegisterResult = { ok: true; jobId: string; rows: number } | { ok: false; problems: string[] };

const isUniqueViolation = (error: unknown): boolean => {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
};

const shownName = (name: string): string => name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[/\\]/g, "-").trim().slice(0, 120) || "orders.csv";

/** Registers a file the browser uploaded: read, refused with a sentence (and removed), or kept as a job in `uploaded`. One open a store. */
export async function registerHistoryImport(member: Membership, input: { path: string; name: string }, deps: DataDeps = {}): Promise<RegisterResult> {
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
  const read = readHistoryFile(bytes);
  if (!read.ok) return refuse(read.problems);
  const count = read.orders.length + read.problems.length;
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.data_jobs (store_id, kind, status, format, requested_by, input_path, input_name, input_bytes, input_sha256, rows_total)
      values (${storeId}::uuid, ${KIND}, 'uploaded', 'shopify', ${member.account.id}::uuid, ${input.path}, ${shownName(input.name)}, ${bytes.length}, ${sha256Of(bytes)}, ${count})
      returning id
    `);
    return { ok: true, jobId: String(row.id), rows: count };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return refuse(["Another order history import is open for this store. Finish it or cancel it first."]);
  }
}

export type StepResult = { ok: true } | { ok: false; problem: string };

/** Starts (or restarts) the dry run: it writes no order. */
export async function checkHistoryImport(member: Membership, jobId: string, run: (id: string) => Promise<unknown>, deps: DataDeps = {}): Promise<StepResult> {
  if (!memberCan(member, KEY)) return { ok: false, problem: NO_ACCESS };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== KIND) return { ok: false, problem: "This import could not be found." };
  if (job.status !== "uploaded" && job.status !== "checked") return { ok: false, problem: job.status === "checking" ? "The file is being checked." : "This import can no longer be checked." };
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = 'checking', phase = 'check', options = '{}'::jsonb, cursor = '{}'::jsonb, counts = '{}'::jsonb,
           rows_done = null, rows_total = null, attempts = 0, claimed_until = null, problem = null
     where store_id = ${member.store.id}::uuid and id = ${job.id}::uuid and kind = ${KIND} and status in ('uploaded', 'checked')
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "This import can no longer be checked." };
  await db().execute(sql`delete from commerce.data_job_items where store_id = ${member.store.id}::uuid and job_id = ${job.id}::uuid`);
  scheduleJob(deps, () => run(job.id));
  return { ok: true };
}

export type HistoryDry = { toCreate: number; already: number; withProblems: number };

export const historyDryCountsOf = (job: Pick<DataJob, "counts">): HistoryDry => {
  const d = (job.counts.dry ?? {}) as Record<string, unknown>;
  return { toCreate: Number(d.toCreate ?? 0), already: Number(d.already ?? 0), withProblems: Number(d.withProblems ?? 0) };
};

/** Starts the apply of a checked import; the start is written to the activity log first (counts only). */
export async function applyHistoryImport(member: Membership, jobId: string, run: (id: string) => Promise<unknown>, deps: DataDeps = {}): Promise<StepResult> {
  if (!memberCan(member, KEY)) return { ok: false, problem: NO_ACCESS };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== KIND) return { ok: false, problem: "This import could not be found." };
  if (job.status !== "checked") return { ok: false, problem: "Check the file first." };
  const dry = historyDryCountsOf(job);
  if (dry.toCreate === 0) return { ok: false, problem: "No order of this file can be imported. Fix the problems the check found and check it again." };
  try {
    await audit(member.account.id, member.store.id, "order.history_import_started", { job: job.id, orders: job.rowsTotal, toCreate: dry.toCreate }, { area: "orders", target: { type: "data_job", id: job.id } });
  } catch (error) {
    log("error", "history_import.audit_failed", { job: job.id, step: "start" }, error);
    return { ok: false, problem: "The activity log could not be written, so the import was not started. Try again." };
  }
  const rows = await db().execute<Row>(sql`
    update commerce.data_jobs
       set status = 'queued', phase = 'apply', cursor = ${JSON.stringify({ next: 0 })}::jsonb, counts = ${JSON.stringify({ ...EMPTY_COUNTS, dry })}::jsonb,
           rows_done = 0, attempts = 0, claimed_until = null, problem = null
     where store_id = ${member.store.id}::uuid and id = ${job.id}::uuid and kind = ${KIND} and status = 'checked'
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "Check the file first." };
  scheduleJob(deps, () => run(job.id));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

type Entry = { order: HistoryOrder | null; problem: HistoryProblem | null; rows: number[]; ref: string | null };
type Prepared = { storeId: string; entries: Entry[] };

/** The file of a run, read again at the start of EVERY run and held to the SHA-256 it was registered with. Problems first, then orders, each in the file's order. */
async function prepare(job: DataJob, deps: DataDeps): Promise<Prepared> {
  const storage = storageOf(deps);
  if (!storage || !job.inputPath) throw new StorageDown();
  const bytes = await storage.download(IMPORTS_BUCKET, job.inputPath);
  if (!bytes) throw new StorageDown();
  if (sha256Of(bytes) !== job.inputSha256) throw new JobStopped("The file is not the one that was checked. Upload it again.");
  const read = readHistoryFile(bytes);
  if (!read.ok) throw new JobStopped(read.problems[0]);
  const entries: Entry[] = [
    ...read.problems.map((p) => ({ order: null, problem: p, rows: p.rows, ref: p.order })),
    ...read.orders.map((o) => ({ order: o, problem: null, rows: o.rows, ref: o.name })),
  ];
  return { storeId: job.storeId, entries };
}

const problemFinding = (p: HistoryProblem): Finding => finding("history.problem", { reason: PROBLEM_WORDS[p.problem] });
const ALREADY = (): Finding => finding("history.already");

/** The orders of a chunk this store has already (imported before, or a number taken). */
async function alreadyHere(storeId: string, orders: readonly HistoryOrder[]): Promise<Set<string>> {
  if (orders.length === 0) return new Set();
  const numbers = orders.map((o) => historyNumber(o.name));
  const rows = await db().execute<Row>(sql`
    select number from commerce.orders where store_id = ${storeId}::uuid and number in (${sql.join(numbers.map((n) => sql`${n}`), sql`, `)})
  `);
  return new Set(rows.map((r) => String(r.number)));
}

type Judged = { action: "create" | "already" | "skip"; findings: Finding[] };

async function judge(p: Prepared, at: number, count: number): Promise<Judged[]> {
  const slice = p.entries.slice(at, at + count);
  const here = await alreadyHere(p.storeId, slice.flatMap((e) => (e.order ? [e.order] : [])));
  return slice.map((e): Judged => {
    if (!e.order) return { action: "skip", findings: e.problem ? [problemFinding(e.problem)] : [] };
    if (here.has(historyNumber(e.order.name))) return { action: "already", findings: [ALREADY()] };
    return { action: "create", findings: [] };
  });
}

function itemOf(seq: number, e: Entry, j: Judged, dry: boolean): ItemInput {
  const outcome: ItemOutcome = dry ? "checked" : j.action === "create" ? "created" : j.action === "already" ? "unchanged" : "failed";
  return { seq, kind: "order", ref: e.ref, rows: e.rows, outcome, messages: j.findings, changes: { will: j.action === "create" ? "created" : j.action === "already" ? "unchanged" : "skipped" } };
}

const chunkOf = (deps: DataDeps): number => Math.max(1, deps.chunkRows ?? INVENTORY_APPLY_CHUNK);

/** One run of a dry run: judges the orders chunk by chunk, writing an item for each and no order. */
export async function runHistoryCheck(job: DataJob, deps: DataDeps, until: number): Promise<"checked" | "paused"> {
  const p = await prepare(job, deps);
  const c = job.cursor as { next?: number; dry?: Partial<HistoryDry> };
  const cursor = { next: Number(c.next ?? 0), dry: { toCreate: Number(c.dry?.toCreate ?? 0), already: Number(c.dry?.already ?? 0), withProblems: Number(c.dry?.withProblems ?? 0) } };
  const total = p.entries.length;
  const size = chunkOf(deps);
  while (cursor.next < total) {
    if (Date.now() >= until) return "paused";
    const judged = await judge(p, cursor.next, size);
    await putItems(
      job,
      judged.map((j, i) => {
        if (j.action === "create") cursor.dry.toCreate += 1;
        else if (j.action === "already") cursor.dry.already += 1;
        else cursor.dry.withProblems += 1;
        return itemOf(cursor.next + i, p.entries[cursor.next + i], j, true);
      }),
    );
    cursor.next += judged.length;
    if (!(await saveProgress(job, { cursor: { ...cursor }, rowsTotal: total, rowsDone: cursor.next }))) return "paused";
    if (!(await stillRunning(job))) return "paused";
  }
  const counts = { ...cursor.dry, dry: cursor.dry, errors: cursor.dry.withProblems, warnings: 0 };
  const ended = await finishJob(job, { status: "checked", counts, cursor: { ...cursor }, rowsDone: total, rowsTotal: total, phase: "check" });
  return ended ? "checked" : "paused";
}

/** One run of an apply: order by order, each in its own transaction and judged again, the cursor kept so a killed run goes on where it was. */
export async function runHistoryApply(job: DataJob, deps: DataDeps, until: number): Promise<"done" | "paused"> {
  const p = await prepare(job, deps);
  const cursor = { next: Number((job.cursor as { next?: number }).next ?? 0) };
  const total = p.entries.length;
  const dry = (job.counts.dry ?? {}) as Record<string, unknown>;
  let counts: JobCounts = { ...EMPTY_COUNTS, ...(Object.fromEntries(Object.entries(job.counts).filter(([k]) => k in EMPTY_COUNTS)) as Partial<JobCounts>) };
  const size = chunkOf(deps);
  while (cursor.next < total) {
    if (Date.now() >= until) break;
    const end = Math.min(cursor.next + size, total);
    const items: ItemInput[] = [];
    const summaries: ItemSummary[] = [];
    for (let i = cursor.next; i < end; i += 1) {
      const entry = p.entries[i];
      let [j] = await judge(p, i, 1);
      if (j.action === "create" && entry.order) {
        const made = await insertHistoryOrder(job.storeId, entry.order).catch((error) => {
          log("error", "history_import.order_failed", { job: job.id, item: i }, error);
          return "failed" as const;
        });
        if (made === "already") j = { action: "already", findings: [ALREADY()] };
        else if (made === "failed") j = { action: "skip", findings: [finding("save.failed", { handle: entry.ref ?? undefined, reason: "the order could not be saved" })] };
      }
      summaries.push({ outcome: j.action === "create" ? "created" : j.action === "already" ? "unchanged" : "failed", messages: j.findings });
      items.push(itemOf(i, entry, j, false));
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
  await audit(job.requestedBy, job.storeId, "order.history_imported", { job: job.id, orders: total, created: counts.created, unchanged: counts.unchanged, failed: counts.failed }, { area: "orders", target: { type: "data_job", id: job.id } }).catch((error) =>
    log("error", "history_import.audit_failed", { job: job.id, step: "end" }, error),
  );
  return "done";
}

/** The findings of an order history import as a CSV (rows, order, severity, message), through the one writer. Owners. */
export async function historyProblemsCsv(member: Membership, jobId: string): Promise<{ ok: true; filename: string; csv: string } | { ok: false }> {
  if (!memberCan(member, KEY)) return { ok: false };
  const job = await getJob(member.store.id, jobId);
  if (!job || job.kind !== KIND) return { ok: false };
  const rows: Cell[][] = [["rows", "order", "severity", "message"]];
  for (let offset = 0; offset < 200_000; offset += 500) {
    const page = await listItems(member.store.id, job.id, { offset, limit: 500 });
    for (const item of page.items) for (const m of item.messages) rows.push([item.rows.join(" "), item.ref, m.severity, m.text]);
    if (page.items.length < 500) break;
  }
  return { ok: true, filename: `order-history-problems-${new Date().toISOString().slice(0, 10)}.csv`, csv: writeCsv(rows, "standard") };
}
