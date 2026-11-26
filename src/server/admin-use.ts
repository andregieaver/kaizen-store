import "server-only";

import { gzipSync } from "node:zlib";

import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  ADMIN_RECORDING_BUCKET,
  ADMIN_RECORDING_FOLDER,
  pathsOf,
} from "@/lib/recording";
import {
  adminScreenRows,
  type AdminScreenRow,
  type AdminScreenTotals,
} from "@/lib/admin-use-figures";
import { HEAT_DEVICES } from "@/lib/page-heat";

import { audit } from "./auth";
import { log } from "./log";
import { recordingFiles, type RecordingFiles } from "./recording-files";
import { readEvents } from "./recordings-read";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * What Kaizena Flow's team sees of owners' own use of the admin (D895 phase 3b, Platform → Admin use): each measured screen's figures over
 * the last 30 days (arithmetic in `admin-use-figures.ts`), and the recordings, most frustrated first; one recording's events only after
 * the viewing is written to the activity log, read from the bucket `admin-recordings` and sanitised as the stores' are.
 */

export const ADMIN_USE_DAYS = 30;
export const ADMIN_RECORDINGS_PAGE = 50;

const TOTALS = z.object({
  screen: col.text,
  views: col.int,
  frustrated: col.int,
  dead: col.int,
  rage: col.int,
  deep: col.int,
});

/** Each screen's totals over the last `days` days, worked into figures in code. */
export async function adminScreenFigures(
  now: Date = new Date(),
  days: number = ADMIN_USE_DAYS,
): Promise<AdminScreenRow[]> {
  const rows = await typedRows(
    TOTALS,
    sql`select screen, sum(views)::int as views, sum(frustrated_views)::int as frustrated, sum(dead_clicks)::int as dead, sum(rage_clicks)::int as rage,
          sum(reach[21])::int as deep
        from commerce.platform_admin_heat_days
        where day >= (${now.toISOString()}::timestamptz - make_interval(days => ${days}))::date
        group by screen`,
  );
  return adminScreenRows(rows satisfies AdminScreenTotals[]);
}

export type AdminRecordingRow = {
  id: string;
  startedAt: string;
  durationMs: number;
  device: (typeof HEAT_DEVICES)[number];
  entryScreen: string;
  screens: string[];
  ageBand: "week" | "month" | "older";
  clicks: number;
  deadClicks: number;
  rageClicks: number;
  seqs: number[];
};

const RECORDING = z.object({
  id: col.uuid,
  started_at: col.timestamp,
  duration_ms: col.int,
  device: z.enum(HEAT_DEVICES),
  entry_screen: col.text,
  screens: z.array(z.string()),
  age_band: z.enum(["week", "month", "older"]),
  clicks: col.int,
  dead_clicks: col.int,
  rage_clicks: col.int,
  seqs: z.array(z.union([z.number(), z.string()]).transform(Number)),
});

const rowOf = (r: z.output<typeof RECORDING>): AdminRecordingRow => ({
  id: r.id,
  startedAt: r.started_at,
  durationMs: r.duration_ms,
  device: r.device,
  entryScreen: r.entry_screen,
  screens: r.screens,
  ageBand: r.age_band,
  clicks: r.clicks,
  deadClicks: r.dead_clicks,
  rageClicks: r.rage_clicks,
  seqs: r.seqs,
});

/** The recordings with something kept, most frustrated first (rage clicks, then dead ones), then newest; at most 50. */
export async function adminRecordings(): Promise<AdminRecordingRow[]> {
  const rows = await typedRows(
    RECORDING,
    sql`select id, started_at, duration_ms, device, entry_screen, screens, age_band, clicks, dead_clicks, rage_clicks, seqs
        from commerce.platform_admin_recordings where segments > 0
        order by rage_clicks desc, dead_clicks desc, started_at desc limit ${ADMIN_RECORDINGS_PAGE}`,
  );
  return rows.map(rowOf);
}

/** One recording, or null. */
export async function adminRecordingOf(
  id: string,
): Promise<AdminRecordingRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(
    RECORDING,
    sql`select id, started_at, duration_ms, device, entry_screen, screens, age_band, clicks, dead_clicks, rage_clicks, seqs
        from commerce.platform_admin_recordings where id = ${id}::uuid`,
  );
  return row ? rowOf(row) : null;
}

export type AdminEventsAnswer =
  | { status: 200; body: Uint8Array }
  | { status: 404 | 503 };

/**
 * One recording's events for the platform's player: the viewing is written to the activity log FIRST (if it cannot be, nothing is sent),
 * then the events, already scrubbed when kept, are sanitised as the stores' are and go gzipped. `files` and `log` are injectable for tests.
 */
export async function serveAdminRecordingEvents(
  accountId: string,
  id: string,
  deps: { files?: RecordingFiles | null; log?: typeof audit } = {},
): Promise<AdminEventsAnswer> {
  const row = await adminRecordingOf(id);
  if (!row) return { status: 404 };
  const write = deps.log ?? audit;
  try {
    await write(
      accountId,
      null,
      "platform.admin_recording_viewed",
      {
        recording: id,
        device: row.device,
        durationS: Math.round(row.durationMs / 1000),
      },
      { target: { type: "admin_recording", id } },
    );
  } catch (error) {
    log("error", "admin_recordings.view_not_logged", {}, error);
    return { status: 503 };
  }
  const files =
    deps.files === undefined
      ? recordingFiles(ADMIN_RECORDING_BUCKET)
      : deps.files;
  const paths = pathsOf({
    storeId: ADMIN_RECORDING_FOLDER,
    id: row.id,
    sealed: false,
    seqs: row.seqs,
  });
  const events =
    files && paths.length > 0
      ? await readEvents(files, paths, [], { recordingId: row.id })
      : [];
  return {
    status: 200,
    body: new Uint8Array(gzipSync(JSON.stringify(events))),
  };
}
