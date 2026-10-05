import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { Dropped, PartInfo } from "@/lib/replicate-build";
import type { PageCapture } from "@/lib/replicate-capture";
import { LOG_MAX, appendLog, finished, progressOf, type LogLevel, type ReplicaJob, type ReplicaLogEntry, type ReplicaNote, type ReplicaPass, type ReplicaPhase, type ReplicaPreviews, type ReplicaStatus, type ReplicaSummary } from "@/lib/replicate";
import type { GridReport, GridStretch } from "@/lib/replicate-grid";
import type { Analysis } from "@/lib/replicate-prompts";
import type { FinalDiff } from "@/lib/replicate-report";
import { frameTokenValid, signFrame } from "@/lib/replicate-token";
import type { StyleModel } from "@/lib/replicate-styles";

import { removeStoredFiles, uploadBytes } from "./media";
import { encryptionKey } from "./settings";

type Row = Record<string, unknown>;

/**
 * The page replicator's jobs in the database (D150): created, locked while a tick works on them, logged for the owner's
 * panel, asked to stop, and tidied away after thirty days with their pictures. What a job keeps while it works is
 * `ReplicaWork`; what the browser is shown is `ReplicaJob` (`src/lib/replicate.ts`), which has none of the captured page.
 */

export type KeptAsset = { url: string; width: number; height: number };

/** The job's working state, in `page_replications.work`. */
export type ReplicaWork = {
  analysis?: Analysis | null;
  vision?: { used: boolean; why: string | null };
  title?: string;
  description?: string;
  /** The original's own page colour: the copy's preview page is painted with it, as what shows between rows. */
  background?: string;
  /** The preview pictures the owner sees. */
  previews?: ReplicaPreviews;
  /** The full photographs of the original, kept to compare each pass with (JPEG in the media bucket). */
  originals?: { desktop: string | null; mobile: string | null };
  /** The same photographs with the words not painted (JPEG in the media bucket), which rows kept as a picture are cut from (D164). */
  textless?: { desktop: string | null; mobile: string | null };
  /** Storage paths of every file the job made, removed with it. */
  files?: string[];
  assets?: {
    pictures: Record<string, KeptAsset | null>;
    pictureQueue: string[];
    videos: Record<string, { url: string } | null>;
    videoQueue: string[];
    /** Pictures of elements the browser photographed (icons, canvases), by path in the capture. */
    shots: Record<string, KeptAsset | null>;
    /** Rows kept as a picture of the original with its words laid over it, by the row's path in the capture: the strip's picture at each width (D164). */
    backdrops?: Record<string, { text: { desktop: KeptAsset; phone: KeptAsset | null }; plain: { desktop: KeptAsset; phone: KeptAsset | null } }>;
    fonts: Record<string, string | null>;
    fontQueue: string[];
    failures: Record<string, string>;
    total: number;
  };
  model?: StyleModel;
  parts?: PartInfo[];
  shared?: string;
  notes?: ReplicaNote[];
  /** What the converter left out or simplified, with where it was in the original (for the report). */
  dropped?: Dropped[];
  /** What the converter did with repeated cards: the grids built and the groups kept as columns (D155, for the summary and the report). */
  grids?: GridReport;
  /** Groups of cards built as a grid that were weak and, tried as columns, matched clearly better over the same stretch: columns now, never a grid again (D155). `match`: how the grid matched there, `columns`: how the columns did. */
  reverted?: { path: string; match: number; pass: number; columns?: number }[];
  /** Grids that were weak, tried as columns, and matched no better: the grid stays, and is not tried again; both figures are said in the report. */
  tried?: { path: string; grid: number; columns: number; pass: number }[];
  /** A trial of columns against weak grids that is running: the copy was rebuilt with those groups as columns, and the next measurement judges it (D155). */
  trial?: GridTrial | null;
  /** Groups whose trial is over, whichever way: never tried again. */
  settled?: string[];
  /** The next measurement is of a page rebuilt at the same pass (a trial's start or end): its score replaces the pass's, and no improving pass is spent on it. */
  remeasure?: boolean;
  /** How many trials of columns the job has started (at most two: each costs a measurement). */
  trials?: number;
  /** Rows that matched the original badly and were rebuilt as a picture of the original (its words not painted) with the words laid over it: where, and how they matched before (D164). Added to by each of the job's two rounds. */
  /** The rows kept as a picture that are only a picture, their words hidden, because words over a picture would not fit the page's CSS (D164): by the row's key. */
  backdropPlain?: string[];
  /** How many of the job's two rounds of rows kept as pictures have been done (D164). */
  backdropRounds?: number;
  backdropped?: { path: string; y: number; height: number; desktop: number | null; phone: number | null; pass: number }[];
  /** How each row and part of the last copy compares with the original (for the report). */
  finalDiff?: FinalDiff;
  /** What the style came to, and what was cut from it to fit. */
  cssTrimmed?: string | null;
  counts?: ReplicaSummary["counts"];
  words?: number;
  passes?: ReplicaPass[];
  stoppedEarly?: boolean;
  /** The page's CSS as last saved, to see if a pass changed anything. */
  cssLength?: number;
};

/** What was built, as it stood, kept for a trial of columns so the grid can be put back exactly (rows and style as saved, and what the converter said of them). */
export type GridSnapshot = {
  rows: unknown;
  css: string;
  model: StyleModel;
  parts: PartInfo[];
  shared: string;
  notes: ReplicaNote[];
  counts: ReplicaSummary["counts"];
  dropped: Dropped[];
  grids: GridReport;
  cssLength: number;
  cssTrimmed: string | null;
  reverted: NonNullable<ReplicaWork["reverted"]>;
};

/** Weak grids sent back to columns, to see whether the columns match better where the grids stood (D155: a grid may never make a copy worse than columns were). */
export type GridTrial = {
  /** The pass it was started in. */
  pass: number;
  /** Each group, and how the grid matched over its stretch of the original at each width measured. */
  groups: { path: string; sel: string; y: number; grid: { desktop: number | null; phone: number | null }; stretch: GridStretch }[];
  snapshot: GridSnapshot;
};

export type ReplicaRow = {
  id: string;
  storeId: string;
  requestedBy: string | null;
  url: string;
  status: ReplicaStatus;
  abortRequested: boolean;
  iterationsMax: number;
  iteration: number;
  phase: ReplicaPhase;
  log: ReplicaLogEntry[];
  work: ReplicaWork;
  pageId: string | null;
  summary: ReplicaSummary | null;
  lockedUntil: string | null;
  heartbeatAt: string | null;
  createdAt: string;
  finishedAt: string | null;
};

const COLUMNS = sql`id, store_id, requested_by, url, status, abort_requested, iterations_max, iteration, phase, log, work, page_id, summary, locked_until, heartbeat_at, created_at, finished_at`;

function toRow(row: Row): ReplicaRow {
  const iso = (value: unknown) => (value === null || value === undefined ? null : new Date(value as string).toISOString());
  return {
    id: String(row.id),
    storeId: String(row.store_id),
    requestedBy: row.requested_by === null ? null : String(row.requested_by),
    url: String(row.url),
    status: row.status as ReplicaStatus,
    abortRequested: Boolean(row.abort_requested),
    iterationsMax: Number(row.iterations_max),
    iteration: Number(row.iteration),
    phase: row.phase as ReplicaPhase,
    log: (row.log as ReplicaLogEntry[]) ?? [],
    work: (row.work as ReplicaWork) ?? {},
    pageId: row.page_id === null ? null : String(row.page_id),
    summary: (row.summary as ReplicaSummary | null) ?? null,
    lockedUntil: iso(row.locked_until),
    heartbeatAt: iso(row.heartbeat_at),
    createdAt: iso(row.created_at)!,
    finishedAt: iso(row.finished_at),
  };
}

const EMPTY_PREVIEWS: ReplicaPreviews = { original: { desktop: null, mobile: null }, copy: { desktop: null, mobile: null, iteration: null } };

/** What the owner's page reads of a job. */
export function viewOf(row: ReplicaRow, doing = ""): ReplicaJob {
  const within = row.phase === "assets" && row.work.assets && row.work.assets.total > 0 ? 1 - (row.work.assets.pictureQueue.length + row.work.assets.videoQueue.length + row.work.assets.fontQueue.length) / row.work.assets.total : 0;
  return {
    id: row.id,
    url: row.url,
    status: row.status,
    phase: row.phase,
    iteration: row.iteration,
    iterationsMax: row.iterationsMax,
    progress: progressOf(row, within),
    doing: doing || row.log[row.log.length - 1]?.text || "",
    log: row.log,
    previews: row.work.previews ?? EMPTY_PREVIEWS,
    passes: row.work.passes ?? [],
    summary: row.summary,
    pageId: row.pageId,
    abortRequested: row.abortRequested,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

/** A job's row, if it is the store's. */
export async function getRow(id: string, storeId: string): Promise<ReplicaRow | null> {
  const [row] = await db().execute<Row>(sql`select ${COLUMNS} from commerce.page_replications where id = ${id}::uuid and store_id = ${storeId}::uuid`);
  return row ? toRow(row) : null;
}

/** The store's latest job: the active one if there is one, else the last. */
export async function latestRow(storeId: string): Promise<ReplicaRow | null> {
  const [row] = await db().execute<Row>(sql`
    select ${COLUMNS} from commerce.page_replications where store_id = ${storeId}::uuid
    order by (status in ('queued', 'running')) desc, created_at desc limit 1
  `);
  return row ? toRow(row) : null;
}

/** The longest an active job may stand with nobody working on it before the next one may replace it. */
const ABANDONED_AFTER = "2 hours";

/** Starts a job for a store; null when one is already at work for it. */
export async function createRow(storeId: string, accountId: string, url: string, iterations: number): Promise<ReplicaRow | null> {
  // A job left standing by a closed tab does not block the store for ever.
  await db().execute(sql`
    update commerce.page_replications
    set status = 'failed', finished_at = now(), summary = ${JSON.stringify({ outcome: "failed", wentWell: [], problems: ["The copy stopped because the page was closed and nobody came back to it."], finalMatch: { desktop: null, mobile: null }, passes: [], counts: { rows: 0, blocks: 0, headings: 0, texts: 0, pictures: 0, buttons: 0, videos: 0 }, design: null, page: null } satisfies ReplicaSummary)}::jsonb
    where store_id = ${storeId}::uuid and status in ('queued', 'running') and coalesce(heartbeat_at, created_at) < now() - ${ABANDONED_AFTER}::interval
  `);
  const rows = await db().execute<Row>(sql`
    insert into commerce.page_replications (store_id, requested_by, url, iterations_max, heartbeat_at)
    values (${storeId}::uuid, ${accountId}::uuid, ${url}, ${iterations}, now())
    on conflict (store_id) where status in ('queued', 'running') do nothing
    returning ${COLUMNS}
  `);
  return rows[0] ? toRow(rows[0]) : null;
}

/** Takes the job for one tick: false if another tick has it, or it has ended. */
export async function lockRow(id: string, seconds = 290): Promise<ReplicaRow | null> {
  const [row] = await db().execute<Row>(sql`
    update commerce.page_replications
    set locked_until = now() + (${seconds} * interval '1 second'), status = 'running', started_at = coalesce(started_at, now()), heartbeat_at = now()
    where id = ${id}::uuid and status in ('queued', 'running') and (locked_until is null or locked_until < now())
    returning ${COLUMNS}
  `);
  return row ? toRow(row) : null;
}

export async function unlockRow(id: string): Promise<void> {
  await db().execute(sql`update commerce.page_replications set locked_until = null, heartbeat_at = now() where id = ${id}::uuid`);
}

/** Adds to the log (the last four hundred kept) and shows the job is alive. */
export async function log(id: string, phase: ReplicaPhase, level: LogLevel, text: string): Promise<void> {
  const entry: ReplicaLogEntry = { at: new Date().toISOString(), level, phase, text: text.slice(0, 400) };
  await db().execute(sql`
    update commerce.page_replications
    set log = (case when jsonb_array_length(log) >= ${LOG_MAX} then log - 0 else log end) || ${JSON.stringify([entry])}::jsonb,
        heartbeat_at = now()
    where id = ${id}::uuid
  `);
}

/** Merges into the job's working state. */
export async function patchWork(id: string, work: Partial<ReplicaWork>): Promise<void> {
  await db().execute(sql`update commerce.page_replications set work = work || ${JSON.stringify(work)}::jsonb where id = ${id}::uuid`);
}

export async function setPhase(id: string, phase: ReplicaPhase, iteration?: number): Promise<void> {
  await db().execute(sql`
    update commerce.page_replications set phase = ${phase}, iteration = coalesce(${iteration ?? null}::int, iteration), heartbeat_at = now() where id = ${id}::uuid
  `);
}

export async function setPage(id: string, pageId: string): Promise<void> {
  await db().execute(sql`update commerce.page_replications set page_id = ${pageId}::uuid where id = ${id}::uuid`);
}

export async function saveCapture(id: string, capture: { desktop: PageCapture; mobile: PageCapture | null }): Promise<void> {
  await db().execute(sql`update commerce.page_replications set capture = ${JSON.stringify(capture)}::jsonb where id = ${id}::uuid`);
}

export async function readCapture(id: string): Promise<{ desktop: PageCapture; mobile: PageCapture | null } | null> {
  const [row] = await db().execute<Row>(sql`select capture from commerce.page_replications where id = ${id}::uuid`);
  return row?.capture ? (row.capture as { desktop: PageCapture; mobile: PageCapture | null }) : null;
}

/** Ends a job: its summary, and the status it ended in. */
export async function finishRow(id: string, status: Exclude<ReplicaStatus, "queued" | "running">, summary: ReplicaSummary): Promise<void> {
  await db().execute(sql`
    update commerce.page_replications
    set status = ${status}, phase = 'done', summary = ${JSON.stringify(summary)}::jsonb, finished_at = now(), locked_until = null, capture = null
    where id = ${id}::uuid and status in ('queued', 'running')
  `);
}

/** The owner pressed Abort: the working tick sees it and stops. */
export async function askToAbort(id: string, storeId: string): Promise<ReplicaRow | null> {
  const [row] = await db().execute<Row>(sql`
    update commerce.page_replications set abort_requested = true
    where id = ${id}::uuid and store_id = ${storeId}::uuid and status in ('queued', 'running')
    returning ${COLUMNS}
  `);
  return row ? toRow(row) : null;
}

export async function aborting(id: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select abort_requested from commerce.page_replications where id = ${id}::uuid`);
  return Boolean(row?.abort_requested);
}

/** Whether the tick lock has run out or was never taken: nobody is working on the job. */
export const idle = (row: ReplicaRow): boolean => !row.lockedUntil || new Date(row.lockedUntil).getTime() < Date.now();

export const ended = (row: ReplicaRow): boolean => finished(row.status);

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const BUCKET = "product-media";
export const filePath = (storeId: string, jobId: string, name: string) => `${storeId}/replica-${jobId}/${name}`;

/** Keeps a picture of the job's work in Storage (public, under a name nobody can guess); its address and path. */
export async function putFile(storeId: string, jobId: string, name: string, bytes: Uint8Array, contentType: string): Promise<{ url: string; path: string } | null> {
  const path = filePath(storeId, jobId, name);
  const uploaded = await uploadBytes(BUCKET, path, bytes, contentType);
  return uploaded.ok ? { url: uploaded.url, path } : null;
}

/** Removes files the job made. */
export async function removeFiles(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 50) await removeStoredFiles(BUCKET, paths.slice(i, i + 50));
}

/** Forgets jobs older than thirty days with the pictures they made; called by the daily upkeep. */
export async function pruneReplications(): Promise<{ jobs: number }> {
  const old = await db().execute<Row>(sql`select id, work from commerce.page_replications where created_at < now() - interval '30 days' and status not in ('queued', 'running') limit 100`);
  for (const row of old) await removeFiles(((row.work as ReplicaWork | null)?.files ?? []).slice(0, 500));
  if (old.length > 0) await db().execute(sql`delete from commerce.page_replications where id in (${sql.join(old.map((r) => sql`${String(r.id)}::uuid`), sql`, `)})`);
  return { jobs: old.length };
}

// ---------------------------------------------------------------------------
// The copy's preview page is opened by the browser the job runs, with a token
// ---------------------------------------------------------------------------

function frameKey(): Buffer {
  const key = encryptionKey();
  if (!key) throw new Error("The server has no encryption key, so pages cannot be copied.");
  return key;
}

/** A token that lets the browser of this job open the job's draft for a while, and nothing else. */
export const frameToken = (id: string): string => signFrame(frameKey(), id);

export const frameTokenOk = (id: string, token: string | undefined): boolean => {
  const key = encryptionKey();
  return key !== null && frameTokenValid(key, id, token);
};

/** The draft page a job builds, for the preview page: the job's store and the draft, if the token is right. */
export async function frameDraft(id: string, token: string | undefined): Promise<{ storeId: string; storeSlug: string; pageId: string; draft: unknown; background: string | null } | null> {
  if (!frameTokenOk(id, token)) return null;
  const [row] = await db().execute<Row>(sql`
    select r.store_id, s.slug as store_slug, r.page_id, p.draft, r.work->>'background' as background
    from commerce.page_replications r join commerce.pages p on p.id = r.page_id join commerce.stores s on s.id = r.store_id
    where r.id = ${id}::uuid and r.status in ('queued', 'running', 'done')
  `);
  return row ? { storeId: String(row.store_id), storeSlug: String(row.store_slug), pageId: String(row.page_id), draft: row.draft, background: row.background ? String(row.background) : null } : null;
}

export { appendLog };
