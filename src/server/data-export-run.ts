import "server-only";

import { writeCsv, type Cell, type DialectId } from "@/lib/csv";
import { DIRECT_EXPORT_MAX_ROWS, EXPORT_MAX_ROWS, EXPORT_PART_ROWS } from "@/lib/data-limits";
import { EMPTY_COUNTS } from "@/lib/data-job";

import {
  EXPORTS_BUCKET,
  chunkPath,
  finishJob,
  partPath,
  saveProgress,
  sha256Of,
  stillRunning,
  StorageDown,
  storageOf,
  type DataDeps,
  type DataJob,
  type DataJobFile,
} from "./data-job-store";

/**
 * The loop every export job runs (D165, `docs/wave-2-data.md` 3.1 and 5.2): a reader gives the file's rows a batch at a time, a keyset
 * position so a run that stops goes on where it was; each batch is written as a chunk in the private `exports` bucket and the cursor saved;
 * when the reader has no more, the chunks are put together into parts of at most `EXPORT_PART_ROWS` rows, each with its header and, in the
 * Nordic dialect, its byte order mark, and the chunks are removed. Nothing is held in memory but one batch, and one part while it is put
 * together. A part is stored with upsert, so a run that stops while assembling does it again. An export is never served from memory when
 * storage is down: the run fails to store, is tried again, and after the attempts the job is failed.
 */

/** What a kind of export gives the loop. */
export type ExportReader = {
  /** The header row of every part. */
  header: readonly Cell[];
  dialect: DialectId;
  /** The base of the file names: `products`, `orders`, `customers`. The date and part number are added. */
  fileBase: string;
  /** The next batch after a position (null at the start): its rows, its new position and whether there is more after it. */
  read(position: unknown, limit: number): Promise<{ rows: Cell[][]; position: unknown; more: boolean; units: number }>;
  /** Source units to report progress in (products, orders, customers), once. */
  total?: () => Promise<number>;
};

type Chunk = { n: number; rows: number };
type ExportCursor = { position: unknown; chunks: Chunk[]; rows: number; units: number; complete: boolean };

const cursorOf = (job: DataJob): ExportCursor => {
  const c = job.cursor as Partial<ExportCursor>;
  return { position: c.position ?? null, chunks: Array.isArray(c.chunks) ? c.chunks : [], rows: Number(c.rows ?? 0), units: Number(c.units ?? 0), complete: c.complete === true };
};

const BOM = /^﻿/;
/** A chunk's rows as text: no header and no byte order mark (a part has one of each, put on by the assembly). */
const chunkText = (rows: readonly (readonly Cell[])[], dialect: DialectId): string => writeCsv(rows, dialect).replace(BOM, "");

/** Removes files this run stored that no row names (best effort: the folder is listed and cleared again by whoever ended the job, and by the nightly sweep). */
async function dropStored(storage: NonNullable<ReturnType<typeof storageOf>>, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await storage.remove(EXPORTS_BUCKET, paths).catch(() => false);
}

/** A stop with a plain reason: the job is failed with it, not tried again. */
export class JobStopped extends Error {}

const STORAGE_DOWN = "Storage was not available, so the file could not be made. Try again later.";

export type ExportRun = "done" | "paused";

/**
 * One run of an export job that is claimed: writes batches until the time is up or the reader is done, then assembles. Returns `done` when the
 * job is finished (and its files are in `files`), `paused` when it should be taken up again, and throws `JobStopped` to fail it.
 */
export async function runExport(job: DataJob, reader: ExportReader, deps: DataDeps, until: number, finalize?: (job: DataJob, files: DataJobFile[], rows: number) => Promise<void>): Promise<ExportRun> {
  const storage = storageOf(deps);
  if (!storage) throw new JobStopped(STORAGE_DOWN);
  const cursor = cursorOf(job);
  const batch = deps.batchRows ?? 1000;
  const partRows = deps.partRows ?? EXPORT_PART_ROWS;
  let rowsTotal = job.rowsTotal;
  if (rowsTotal === null && reader.total) {
    rowsTotal = await reader.total();
    await saveProgress(job, { rowsTotal });
  }

  // Files written by this run and not yet saved in the job's row: removed again if the row cannot take them (the job is over).
  const chunkOf = new Map<number, string>();
  if (job.phase !== "assemble") {
    let more = !cursor.complete;
    while (more && Date.now() < until) {
      const read = await reader.read(cursor.position, batch);
      if (read.rows.length > 0) {
        const n = (cursor.chunks.at(-1)?.n ?? 0) + 1;
        const path = chunkPath(job.storeId, job.id, n);
        const ok = await storage.upload(EXPORTS_BUCKET, path, new TextEncoder().encode(chunkText(read.rows, reader.dialect)), "text/csv");
        if (!ok) throw new StorageDown();
        cursor.chunks.push({ n, rows: read.rows.length });
        cursor.rows += read.rows.length;
        chunkOf.set(n, path);
      }
      cursor.units += read.units;
      cursor.position = read.position;
      cursor.complete = !read.more;
      more = read.more;
      if (cursor.rows > EXPORT_MAX_ROWS) throw new JobStopped(`The export has more than ${EXPORT_MAX_ROWS.toLocaleString("en")} rows. Narrow the period or the filter and try again.`);
      const done = rowsTotal === null ? null : Math.min(rowsTotal, cursor.units);
      if (!(await saveProgress(job, { cursor: { ...cursor }, rowsDone: done, counts: { ...EMPTY_COUNTS, rows: cursor.rows } }))) {
        // The job was cancelled (or its person erased) while this batch was written: nothing records the file just stored, so nothing else would remove it.
        await dropStored(storage, [...chunkOf.values()]);
        return "paused";
      }
      chunkOf.clear();
    }
    if (more) return "paused";
    await saveProgress(job, { phase: "assemble", cursor: { ...cursor } });
    job.phase = "assemble";
  }

  // Assemble: the chunks, in order, into parts.
  const groups: Chunk[][] = [];
  let current: Chunk[] = [];
  let size = 0;
  for (const chunk of cursor.chunks) {
    if (size > 0 && size + chunk.rows > partRows) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(chunk);
    size += chunk.rows;
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);
  const files: DataJobFile[] = [...job.files];
  const date = new Date().toISOString().slice(0, 10);
  const header = writeCsv([[...reader.header]], reader.dialect);
  for (let i = files.length; i < groups.length; i += 1) {
    if (Date.now() > until && i > 0) return "paused";
    const parts: string[] = [header];
    for (const chunk of groups[i]) {
      const bytes = await storage.download(EXPORTS_BUCKET, chunkPath(job.storeId, job.id, chunk.n));
      if (!bytes) throw new StorageDown();
      parts.push(new TextDecoder().decode(bytes));
    }
    const bytes = new TextEncoder().encode(parts.join(""));
    const path = partPath(job.storeId, job.id, i + 1);
    if (!(await storage.upload(EXPORTS_BUCKET, path, bytes, "text/csv"))) throw new StorageDown();
    const name = `${reader.fileBase}-${date}${groups.length > 1 ? `-part-${i + 1}` : ""}.csv`;
    files.push({ path, name, rows: groups[i].reduce((n, c) => n + c.rows, 0), bytes: bytes.length, sha256: sha256Of(bytes) });
    if (!(await saveProgress(job, { files }))) {
      // Over meanwhile (cancelled, or an erasure took the job): the part just stored is in no row, so it is removed here.
      await dropStored(storage, [path]);
      return "paused";
    }
    if (!(await stillRunning(job))) return "paused";
  }
  if (finalize) await finalize(job, files, cursor.rows);
  const ended = await finishJob(job, {
    status: "done",
    files,
    counts: { ...EMPTY_COUNTS, rows: cursor.rows, parts: files.length },
    rowsDone: rowsTotal,
    rowsTotal,
    phase: "assemble",
    keepDays: 7,
  });
  if (!ended) return "paused";
  // The chunks are only the way to the parts.
  await storage.remove(EXPORTS_BUCKET, cursor.chunks.map((c) => chunkPath(job.storeId, job.id, c.n)));
  return "done";
}

/**
 * A small export made in one go, for a download at once: the whole file as text, or null when it has more rows than a download takes (then it
 * is a job). Reads in batches so a store of a few thousand rows does not hold them all in one query.
 */
export async function buildDirect(reader: ExportReader, batch = 500): Promise<{ csv: string; rows: number } | null> {
  const rows: Cell[][] = [];
  let position: unknown = null;
  for (;;) {
    const read = await reader.read(position, batch);
    rows.push(...read.rows);
    if (rows.length > DIRECT_EXPORT_MAX_ROWS) return null;
    if (!read.more) break;
    position = read.position;
  }
  return { csv: writeCsv([[...reader.header], ...rows], reader.dialect), rows: rows.length };
}
