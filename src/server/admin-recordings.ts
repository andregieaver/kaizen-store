import "server-only";

import { gzipSync } from "node:zlib";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { scrubAdminEvents } from "@/lib/admin-replay-scrub";
import { isMeasuredScreen } from "@/lib/admin-screens";
import {
  ADMIN_RECORDING_BUCKET,
  ADMIN_RECORDING_FOLDER,
  ADMIN_RECORDINGS_PER_DAY,
  appendPages,
  coarseSize,
  coarseTime,
  RECORDING_KEEP_DAYS,
  REC_MAX_BYTES,
  REC_MAX_SEGMENTS,
  segmentPath,
} from "@/lib/recording";
import { storeDayKey } from "@/lib/visit-hash";

import { adminSignalsFor } from "./admin-signals";
import { log } from "./log";
import { recordingFiles, type RecordingFiles } from "./recording-files";
import { readSegment, removeFiles, segmentQuery, type SegmentAnswer } from "./recordings";
import { textList } from "./sql-arrays";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Recordings of store owners' own use of the admin (D895 phase 3b, `docs/dpia-admin-use.md` section 2): the only writer of
 * `commerce.platform_admin_recordings` and the bucket `admin-recordings`. A segment from the admin's recorder is kept only while the switch
 * is open, from a signed-in store owner whose latest choice under the current notice allows recordings, when every screen in it is on the
 * allow-list; its events are scrubbed of every word and address (`scrubAdminEvents()`) before they are stored, and the row names no
 * person, store or address. Read as the stores' segments are (`readSegment()`); pruned after 30 days with every file.
 */

export type AdminRecordingDeps = { files?: RecordingFiles | null };
const filesOf = (deps: AdminRecordingDeps) => (deps.files === undefined ? recordingFiles(ADMIN_RECORDING_BUCKET) : deps.files);

const adminQuery = segmentQuery.omit({ store: true });
const SEQS = z.object({ seqs: z.array(z.union([z.number(), z.string()]).transform(Number)) });
const COUNT = z.object({ n: col.int });

/** The age band of the person's first store they own, the only fact about them a recording keeps. */
async function ageBand(accountId: string, now: Date): Promise<"week" | "month" | "older"> {
  const row = await typedRow(
    z.object({ days: col.int.nullable() }),
    sql`select floor(extract(epoch from (${now.toISOString()}::timestamptz - min(s.created_at))) / 86400)::int as days
        from commerce.stores s join commerce.store_members m on m.store_id = s.id
        where m.account_id = ${accountId}::uuid and m.role = 'owner'`,
  );
  const days = row?.days ?? 999;
  return days < 7 ? "week" : days < 30 ? "month" : "older";
}

/** Keeps one segment of an owner's recording of the admin, or says what the recorder should do instead (the stores' answers). */
export async function recordAdminSegment(
  { accountId, query, bytes, now = new Date() }: { accountId: string; query: Record<string, string | null>; bytes: Uint8Array; now?: Date },
  deps: AdminRecordingDeps = {},
): Promise<SegmentAnswer> {
  const q = adminQuery.safeParse(query);
  if (!q.success) return 400;
  const { id, seq } = q.data;
  const { eligible, choice } = await adminSignalsFor(accountId);
  if (!eligible || !choice?.recordings) return 410;
  const files = filesOf(deps);
  if (!files) return 503;
  const body = readSegment(bytes, q.data.z);
  if (!body) return 400;
  if (!body.meta.pages.every(isMeasuredScreen)) return 410;
  const events = scrubAdminEvents(body.events, body.meta.pages.at(-1) ?? "");
  if (!events) return 410;

  const at = coarseTime(now).toISOString();
  if (seq === 0) {
    if (body.meta.pages.length === 0) return 400;
    const today = storeDayKey(now, PLATFORM_TIME_ZONE);
    const started = await typedRow(COUNT, sql`select count(*)::int as n from commerce.platform_admin_recordings where day = ${today}::date`);
    if ((started?.n ?? 0) >= ADMIN_RECORDINGS_PER_DAY) return 410;
    await db().execute(sql`
      insert into commerce.platform_admin_recordings (id, day, started_at, last_at, device, width, height, entry_screen, age_band)
      values (${id}::uuid, ${today}::date, ${at}::timestamptz, ${at}::timestamptz, ${body.meta.device},
        ${coarseSize(body.meta.w)}, ${coarseSize(body.meta.h)}, ${body.meta.pages[0]}, ${await ageBand(accountId, now)})
      on conflict (id) do nothing
    `);
  }

  // The scrubbed body is what is kept: never the bytes as they came.
  const kept = { v: 1, meta: { ...body.meta, ab: [] }, events };
  const file = gzipSync(JSON.stringify(kept));
  const path = segmentPath(ADMIN_RECORDING_FOLDER, id, seq);
  const uploaded = await files.upload(path, new Uint8Array(file));
  if (uploaded === "failed") return 503;
  const seqsNow = async () => (await typedRow(SEQS, sql`select seqs from commerce.platform_admin_recordings where id = ${id}::uuid`))?.seqs ?? [];
  if (uploaded === "exists" && (await seqsNow()).includes(seq)) return 204;

  const current = await typedRow(z.object({ screens: z.array(z.string()) }), sql`select screens from commerce.platform_admin_recordings where id = ${id}::uuid`);
  const screens = appendPages(current?.screens ?? [], body.meta.pages);
  const maxTs = Math.round(Math.max(...events.map((e) => e.timestamp), 0));
  const updated = await typedRows(
    z.object({ ok: col.int }),
    sql`
      update commerce.platform_admin_recordings set
        seqs = array_append(seqs, ${seq}::smallint), segments = segments + 1, bytes = bytes + ${file.length},
        last_at = ${at}::timestamptz, duration_ms = least(3600000, greatest(duration_ms, ${maxTs})), screens = ${textList(screens)},
        clicks = clicks + ${body.meta.clicks}, dead_clicks = dead_clicks + ${body.meta.dead}, rage_clicks = rage_clicks + ${body.meta.rage}
      where id = ${id}::uuid and segments < ${REC_MAX_SEGMENTS} and bytes + ${file.length} <= ${REC_MAX_BYTES} and not (${seq}::smallint = any(seqs))
      returning 1 as ok
    `,
  );
  if (updated.length > 0) return 204;
  if ((await seqsNow()).includes(seq)) return 204;
  // No row to add to (full, or never started): the file just written goes, so nothing outlives a row.
  if (uploaded === "ok") await files.remove([path]);
  return 410;
}

const GONE = z.object({ store_id: z.string(), id: col.uuid, sealed: col.bool, seqs: z.array(z.union([z.number(), z.string()]).transform(Number)) });

/** Admin recordings older than `RECORDING_KEEP_DAYS` go with their files, a batch at a time until `deadline`; never throws. */
export async function pruneAdminRecordings(now: Date = new Date(), deadline: number = Date.now() + 30_000, deps: AdminRecordingDeps = {}): Promise<number> {
  const files = filesOf(deps);
  if (!files) return 0;
  const before = new Date(now.getTime() - RECORDING_KEEP_DAYS * 86_400_000).toISOString();
  let total = 0;
  try {
    while (Date.now() < deadline) {
      const gone = await typedRows(
        GONE,
        sql`delete from commerce.platform_admin_recordings where id in (
              select id from commerce.platform_admin_recordings where started_at < ${before}::timestamptz order by started_at limit 100
            ) returning ${ADMIN_RECORDING_FOLDER} as store_id, id, false as sealed, seqs`,
      );
      if (gone.length === 0) break;
      await removeFiles(files, gone);
      total += gone.length;
    }
  } catch (error) {
    log("warn", "admin_recordings.prune_failed", {}, error);
  }
  return total;
}
