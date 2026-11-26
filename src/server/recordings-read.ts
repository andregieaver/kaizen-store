import "server-only";

import { gunzipSync, gzipSync } from "node:zlib";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { publicEnv } from "@/lib/env";
import { HEAT_DEVICES, type HeatDevice } from "@/lib/page-heat";
import { storeOrigins } from "@/lib/paths";
import { pathsOf, REC_UNPACKED_MAX_BYTES } from "@/lib/recording";
import { sanitizeEvents } from "@/lib/replay-sanitize";

import { audit } from "./auth";
import { log } from "./log";
import { owned } from "./owned";
import { testsOfTags, type TaggedTest } from "./page-heat-read";
import type { RecordingFiles } from "./recording-files";
import { filesOf, type RecordingDeps } from "./recordings";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Recordings of visits for their owner (D656, `docs/heatmaps-and-recordings.md` 8.5): the list, 50 at a time, most frustrated first or
 * newest first, with the counts its chips show; and one recording's events, read from its files and sanitised before any browser gets
 * them (`sanitizeEvents()`). Every read filters with `owned()`.
 */

export const RECORDINGS_PAGE = 50;

export type RecordingFilters = {
  device?: HeatDevice;
  page?: string;
  has?: "rage" | "dead";
  tag?: string;
  from?: string;
  to?: string;
  sort?: "frustrated" | "newest";
};

export type RecordingRow = {
  id: string;
  startedAt: string;
  durationMs: number;
  device: HeatDevice;
  pages: string[];
  entryPage: string;
  clicks: number;
  deadClicks: number;
  rageClicks: number;
  tags: string[];
  viewedAt: string | null;
};

const ROW = z.object({
  id: col.uuid,
  started_at: col.timestamp,
  duration_ms: col.int,
  device: z.enum(HEAT_DEVICES),
  pages: z.array(z.string()),
  entry_page: col.text,
  clicks: col.int,
  dead_clicks: col.int,
  rage_clicks: col.int,
  tags: z.array(z.string()),
  viewed_at: col.timestampOrNull,
});

function where(storeId: string, f: RecordingFilters, leaveOut: "device" | "has" | null = null): SQL {
  const parts: SQL[] = [owned(storeId)];
  if (f.device && leaveOut !== "device") parts.push(sql`device = ${f.device}`);
  if (f.page) parts.push(sql`${f.page} = any(pages)`);
  if (f.has === "rage" && leaveOut !== "has") parts.push(sql`rage_clicks > 0`);
  if (f.has === "dead" && leaveOut !== "has") parts.push(sql`dead_clicks > 0`);
  if (f.tag) parts.push(sql`tags @> array[${f.tag}]::text[]`);
  if (f.from) parts.push(sql`started_at >= ${f.from}::date`);
  if (f.to) parts.push(sql`started_at < ${f.to}::date`);
  return sql.join(parts, sql` and `);
}

/** A page of recordings, 50 at a time (`page` from 0), and whether there are more. */
export async function listRecordings(storeId: string, filters: RecordingFilters, page = 0): Promise<{ rows: RecordingRow[]; more: boolean }> {
  const order = filters.sort === "newest" ? sql`started_at desc, id` : sql`rage_clicks + dead_clicks desc, started_at desc, id`;
  const rows = await typedRows(
    ROW,
    sql`select id, started_at, duration_ms, device, pages, entry_page, clicks, dead_clicks, rage_clicks, tags, viewed_at
        from commerce.recordings where ${where(storeId, filters)}
        order by ${order} limit ${RECORDINGS_PAGE + 1} offset ${page * RECORDINGS_PAGE}`,
  );
  return {
    more: rows.length > RECORDINGS_PAGE,
    rows: rows.slice(0, RECORDINGS_PAGE).map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      durationMs: r.duration_ms,
      device: r.device,
      pages: r.pages,
      entryPage: r.entry_page,
      clicks: r.clicks,
      deadClicks: r.dead_clicks,
      rageClicks: r.rage_clicks,
      tags: r.tags,
      viewedAt: r.viewed_at,
    })),
  };
}

export type RecordingCounts = { all: number; rage: number; dead: number; mobile: number; tablet: number; desktop: number };

/** The chips' counts: each chip counted with the other filters, never its own kind. */
export async function recordingCounts(storeId: string, filters: RecordingFilters): Promise<RecordingCounts> {
  const [kinds, devices] = await Promise.all([
    typedRow(
      z.object({ all: col.minor, rage: col.minor, dead: col.minor }),
      sql`select count(*)::bigint as all, count(*) filter (where rage_clicks > 0)::bigint as rage, count(*) filter (where dead_clicks > 0)::bigint as dead
          from commerce.recordings where ${where(storeId, filters, "has")}`,
    ),
    typedRows(z.object({ device: z.enum(HEAT_DEVICES), n: col.minor }), sql`select device, count(*)::bigint as n from commerce.recordings where ${where(storeId, filters, "device")} group by device`),
  ]);
  const by = Object.fromEntries(devices.map((d) => [d.device, d.n])) as Partial<Record<HeatDevice, number>>;
  return { all: kinds?.all ?? 0, rage: kinds?.rage ?? 0, dead: kinds?.dead ?? 0, mobile: by.mobile ?? 0, tablet: by.tablet ?? 0, desktop: by.desktop ?? 0 };
}

const ONE = ROW.extend({ sealed: col.bool, seqs: z.array(z.union([z.number(), z.string()]).transform(Number)) });

/** One recording of the store's, or null. */
export async function recordingOf(storeId: string, id: string): Promise<(RecordingRow & { sealed: boolean; seqs: number[] }) | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const r = await typedRow(
    ONE,
    sql`select id, started_at, duration_ms, device, pages, entry_page, clicks, dead_clicks, rage_clicks, tags, viewed_at, sealed, seqs
        from commerce.recordings where ${owned(storeId)} and id = ${id}::uuid`,
  );
  if (!r) return null;
  return {
    id: r.id,
    startedAt: r.started_at,
    durationMs: r.duration_ms,
    device: r.device,
    pages: r.pages,
    entryPage: r.entry_page,
    clicks: r.clicks,
    deadClicks: r.dead_clicks,
    rageClicks: r.rage_clicks,
    tags: r.tags,
    viewedAt: r.viewed_at,
    sealed: r.sealed,
    seqs: r.seqs,
  };
}

/**
 * A recording's events in order, sanitised (D656 8.5 and 8.6): `all.gz` when sealed, else the segments in `seqs` order, each unpacked
 * with a ceiling. A recording with no files gives none without touching storage; a file that cannot be read is skipped.
 */
export async function recordingEvents(store: { id: string; slug: string }, row: { id: string; sealed: boolean; seqs: readonly number[] }, deps: RecordingDeps = {}): Promise<unknown[]> {
  if (!row.sealed && row.seqs.length === 0) return [];
  const files = filesOf(deps);
  if (!files) return [];
  return readEvents(files, pathsOf({ storeId: store.id, id: row.id, sealed: row.sealed, seqs: row.seqs }), storeOrigins(store.slug), { storeId: store.id, recordingId: row.id });
}

/**
 * The events in `paths`, in order, unpacked with a ceiling and sanitised against `origins` (the stores' recordings and the admin's own,
 * D895 phase 3b, `admin-use-read.ts`). A file that cannot be read is skipped; a forged recording the sanitiser cannot read gives nothing.
 */
export async function readEvents(files: RecordingFiles, paths: readonly string[], origins: readonly string[], ids: Record<string, string>): Promise<unknown[]> {
  const events: unknown[] = [];
  for (const path of paths) {
    const bytes = await files.download(path);
    if (!bytes) continue;
    try {
      const body = JSON.parse(gunzipSync(bytes, { maxOutputLength: REC_UNPACKED_MAX_BYTES * 4 }).toString("utf8")) as { events?: unknown };
      if (Array.isArray(body.events)) events.push(...body.events);
    } catch {
      continue;
    }
  }
  try {
    return sanitizeEvents(events, { storeOrigins: [...origins], supabaseOrigin: new URL(publicEnv().NEXT_PUBLIC_SUPABASE_URL).origin });
  } catch (error) {
    // A forged recording the sanitiser cannot read is sent as nothing, never as it came.
    log("error", "recordings.sanitize_failed", ids, error);
    return [];
  }
}

export type EventsAnswer = { status: 200; body: Uint8Array } | { status: 404 | 503 };

/**
 * One recording's events for its owner's player (D656 step 11): the viewing is written to the activity log FIRST (if it cannot be, nothing
 * is sent), the first viewing is noted on the row, then the sanitised events go gzipped. `log` is injectable for the test of a failed audit.
 */
export async function serveRecordingEvents(
  member: { account: { id: string }; store: { id: string; slug: string } },
  id: string,
  deps: RecordingDeps & { log?: typeof audit } = {},
): Promise<EventsAnswer> {
  const row = await recordingOf(member.store.id, id);
  if (!row) return { status: 404 };
  const write = deps.log ?? audit;
  try {
    await write(member.account.id, member.store.id, "analytics.recording_viewed", { recording: id, device: row.device, durationS: Math.round(row.durationMs / 1000) }, { target: { type: "recording", id } });
  } catch (error) {
    log("error", "recordings.view_not_logged", { storeId: member.store.id }, error);
    return { status: 503 };
  }
  await db().execute(sql`update commerce.recordings set viewed_at = now() where id = ${id}::uuid and store_id = ${member.store.id}::uuid and viewed_at is null`);
  const events = await recordingEvents(member.store, row, deps);
  return { status: 200, body: new Uint8Array(gzipSync(JSON.stringify(events))) };
}

/** The tests the kept recordings were tagged with (the version chips on the list, D656 step 12), newest first, with their versions' names. */
export async function recordingTests(storeId: string): Promise<TaggedTest[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, name: col.text, version: col.text, version_name: col.text.nullable() }),
    sql`
      with tags as (
        select distinct split_part(t, ':', 1) as id, split_part(t, ':', 2) as version
        from commerce.recordings, unnest(tags) as t where ${owned(storeId)}
      )
      select e.id, e.name, t.version, v.name as version_name
      from tags t
      join commerce.experiments e on e.id::text = t.id and e.store_id = ${storeId}::uuid
      left join commerce.experiment_variants v on v.experiment_id = e.id and v.key = t.version
      order by e.created_at desc, e.id, t.version
    `,
  );
  return testsOfTags(rows);
}
