import "server-only";

import { gunzipSync, gzipSync } from "node:zlib";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { consentCookieName, decodeConsent } from "@/lib/cookie-consent";
import { isBot } from "@/lib/experiments";
import { HEAT_DEVICES } from "@/lib/page-heat";
import { storeDomain, storeOrigins } from "@/lib/paths";
import {
  appendPages,
  coarseSize,
  coarseTime,
  pathsOf,
  RECORDING_KEEP_DAYS,
  RECORDINGS_PER_STORE_DAY,
  REC_MAX_BYTES,
  REC_MAX_EVENTS,
  REC_MAX_MS,
  REC_MAX_PAGES,
  REC_MAX_SEGMENTS,
  REC_MAX_TAGS,
  REC_UNPACKED_MAX_BYTES,
  segmentPath,
} from "@/lib/recording";
import { speedKind } from "@/lib/speed";
import { storeDayKey } from "@/lib/visit-hash";
import { fromStoresOwnPage, placeOfPath } from "@/lib/visit-record";

import { wantsPrivacy } from "./analytics-visits";
import { checkLimit } from "./limits";
import { log } from "./log";
import { lockedOut } from "./private-mode";
import { recordingFiles, type RecordingFiles } from "./recording-files";
import { budgetVisitor, takeBudget } from "./request-budget";
import { cookieValue, verifiedTags } from "./signal-tags";
import { textList } from "./sql-arrays";
import { getOpenStore, type Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Recordings of visits on the server (D656, `docs/heatmaps-and-recordings.md` 8.2 and 8.3): a segment from the storefront's recorder is
 * checked as a heat summary is (robot, privacy, the store's own page, private mode, the switch) plus its own consent, the platform's hold,
 * the plan's monthly limit and a day's slot; its events are checked and their addresses stripped of queries; then it is stored as a file
 * and the row updated in one conditional statement. Forget, delete and prune remove rows and every file of them. Every function takes an
 * injectable `files`; without Storage (CI) nothing is kept and nothing removed, so a file never outlives its row.
 */

export type RecordingDeps = { files?: RecordingFiles | null };
export const filesOf = (deps: RecordingDeps) => (deps.files === undefined ? recordingFiles() : deps.files);

/** What the route answers: kept, stop recording this tab, invalid, over budget, or our failure (the client drops the segment). */
export type SegmentAnswer = 204 | 410 | 400 | 429 | 503;

export const segmentQuery = z.object({
  store: z.string().regex(/^[a-z0-9-]{1,63}$/),
  id: z.uuid(),
  seq: z.coerce.number().int().min(0).max(REC_MAX_SEGMENTS - 1),
  z: z.enum(["0", "1"]),
});

const count = z.number().int().min(0).max(100_000);
const segmentBody = z.object({
  v: z.literal(1),
  meta: z.object({
    device: z.enum(HEAT_DEVICES),
    w: z.number().min(0).max(20_000),
    h: z.number().min(0).max(20_000),
    pages: z.array(z.string().min(1).max(300)).max(REC_MAX_PAGES),
    clicks: count,
    dead: count,
    rage: count,
    ab: z.array(z.tuple([z.string().max(36), z.string().max(1)])).max(REC_MAX_TAGS),
  }),
  events: z
    .array(z.object({ type: z.number().int().min(0).max(6), timestamp: z.number().min(0).max(REC_MAX_MS + 60_000), data: z.unknown().optional() }))
    .min(1)
    .max(REC_MAX_EVENTS),
});
export type SegmentBody = z.output<typeof segmentBody>;

/** A Meta event's address as its origin and path: no query, no fragment, even from a client that did not strip them. */
export function stripMeta(body: SegmentBody): SegmentBody {
  return {
    ...body,
    events: body.events.map((event) => {
      if (event.type !== 4 || !event.data || typeof event.data !== "object") return event;
      const data = event.data as Record<string, unknown>;
      if (typeof data.href !== "string") return event;
      let href = "";
      try {
        const url = new URL(data.href);
        href = `${url.origin}${url.pathname}`;
      } catch {
        href = "";
      }
      return { ...event, data: { ...data, href } };
    }),
  };
}

/** The plan's monthly limit for new recordings, asked at most once a minute per store and instance. */
const limitMemo = new Map<string, { at: number; ok: boolean }>();
async function underLimit(storeId: string, now: Date): Promise<boolean> {
  const memo = limitMemo.get(storeId);
  if (memo && now.getTime() - memo.at < 60_000) return memo.ok;
  const ok = (await checkLimit(storeId, "recordings_month", 1, now)).ok;
  limitMemo.set(storeId, { at: now.getTime(), ok });
  return ok;
}

/** For tests. */
export function forgetRecordingMemos(): void {
  limitMemo.clear();
}

const recordingsOpen = async (): Promise<boolean> =>
  (await typedRow(z.object({ open: col.bool }), sql`select recordings_open as open from commerce.platform_settings limit 1`))?.open ?? false;

const COUNT = z.object({ count: col.int });
async function takeDaySlot(storeId: string): Promise<boolean> {
  const row = await typedRow(
    COUNT,
    sql`insert into commerce.chat_usage (store_id, bucket, "window", count) values (${storeId}::uuid, 'recordings', date_trunc('day', now()), 1)
        on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1 returning count`,
  );
  return (row?.count ?? 0) <= RECORDINGS_PER_STORE_DAY;
}

function ownPage(h: Headers, store: Store): boolean {
  return fromStoresOwnPage({
    origin: h.get("origin"),
    referer: h.get("referer"),
    requestHost: h.get("x-forwarded-host") ?? h.get("host"),
    slug: store.slug,
    ownHosts: storeOrigins(store.slug).map((origin) => new URL(origin).host),
    storesOnPlatformHost: storeDomain() === null,
  });
}

const OWNER = z.object({ store_id: col.uuid });
const SEQS = z.object({ seqs: z.array(z.union([z.number(), z.string()]).transform(Number)) });

/** Keeps one segment of a recording, or says what the recorder should do instead. */
export async function recordSegment(
  { headers: h, query, bytes, now = new Date() }: { headers: Headers; query: Record<string, string | null>; bytes: Uint8Array; now?: Date },
  deps: RecordingDeps = {},
): Promise<SegmentAnswer> {
  const q = segmentQuery.safeParse(query);
  if (!q.success) return 400;
  const { store: slug, id, seq } = q.data;
  if (isBot(h.get("user-agent")) || wantsPrivacy(h)) return 410;
  const store = await getOpenStore(slug);
  if (!store || !store.recordings) return 410;
  if (await lockedOut(store)) return 410;
  if (!ownPage(h, store)) return 410;
  if (decodeConsent(cookieValue(h.get("cookie"), consentCookieName(store.id)))?.choices.recordings !== true) return 410;
  if (!(await takeBudget(store.id, "rec", budgetVisitor(h)))) return 429;
  const files = filesOf(deps);
  if (!files) return 503;

  let json: string;
  try {
    json = q.data.z === "1" ? gunzipSync(bytes, { maxOutputLength: REC_UNPACKED_MAX_BYTES }).toString("utf8") : new TextDecoder().decode(bytes);
  } catch {
    return 400;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return 400;
  }
  const checked = segmentBody.safeParse(parsed);
  if (!checked.success) return 400;
  const body = stripMeta(checked.data);

  // Every page in it is one heatmaps measure too, never the search page: the recorder should have paused, so nothing is kept.
  const pages: string[] = [];
  for (const path of body.meta.pages) {
    const place = placeOfPath(path, store.slug, store.allMarkets.map((m) => m.code), store.address);
    if (!place || !speedKind(place.landing) || place.landing.split("/")[2] === "search") return 410;
    pages.push(place.landing);
  }

  const at = coarseTime(now).toISOString();
  if (seq === 0) {
    if (!store.house && !(await recordingsOpen())) return 410;
    if (!(await underLimit(store.id, now))) return 410;
    if (!(await takeDaySlot(store.id))) return 410;
    if (pages.length === 0) return 400;
    await db().execute(sql`
      insert into commerce.recordings (id, store_id, day, started_at, last_at, device, width, height, entry_page, mask)
      values (${id}::uuid, ${store.id}::uuid, ${storeDayKey(now, store.timeZone)}::date, ${at}::timestamptz, ${at}::timestamptz, ${body.meta.device},
        ${coarseSize(body.meta.w)}, ${coarseSize(body.meta.h)}, ${pages[0]}, ${store.recordingMask})
      on conflict (id) do nothing
    `);
    const owner = await typedRow(OWNER, sql`select store_id from commerce.recordings where id = ${id}::uuid`);
    if (owner?.store_id !== store.id) return 410;
  }
  const tags = await verifiedTags(store.id, body.meta.ab, h.get("cookie"));

  // The checked, stripped body is what is kept: never the bytes as they came.
  const file = gzipSync(JSON.stringify(body));
  const path = segmentPath(store.id, id, seq);
  const uploaded = await files.upload(path, new Uint8Array(file));
  if (uploaded === "failed") return 503;
  const seqsNow = async () => (await typedRow(SEQS, sql`select seqs from commerce.recordings where id = ${id}::uuid and store_id = ${store.id}::uuid`))?.seqs ?? [];
  if (uploaded === "exists" && (await seqsNow()).includes(seq)) return 204;

  const current = await typedRow(z.object({ pages: z.array(z.string()) }), sql`select pages from commerce.recordings where id = ${id}::uuid and store_id = ${store.id}::uuid`);
  const nextPages = appendPages(current?.pages ?? [], pages);
  const maxTs = Math.round(Math.max(...body.events.map((e) => e.timestamp)));
  const updated = await typedRows(
    z.object({ ok: col.int }),
    sql`
      update commerce.recordings set
        seqs = array_append(seqs, ${seq}::smallint), segments = segments + 1, bytes = bytes + ${file.length},
        last_at = ${at}::timestamptz, duration_ms = least(3600000, greatest(duration_ms, ${maxTs})),
        pages = ${textList(nextPages)},
        clicks = clicks + ${body.meta.clicks}, dead_clicks = dead_clicks + ${body.meta.dead}, rage_clicks = rage_clicks + ${body.meta.rage},
        tags = (select coalesce(array_agg(t order by t), '{}') from (select distinct t from unnest(tags || ${textList(tags)}) t order by t limit ${REC_MAX_TAGS}) x)
      where id = ${id}::uuid and store_id = ${store.id}::uuid and not sealed and segments < ${REC_MAX_SEGMENTS}
        and bytes + ${file.length} <= ${REC_MAX_BYTES} and not (${seq}::smallint = any(seqs))
      returning 1 as ok
    `,
  );
  if (updated.length > 0) return 204;
  if ((await seqsNow()).includes(seq)) return 204;
  // No row to add to (another store's id, a full or sealed recording): the file just written goes, so nothing outlives a row.
  if (uploaded === "ok") await files.remove([path]);
  return 410;
}

export const STORED = z.object({ id: col.uuid, store_id: col.uuid, sealed: col.bool, seqs: z.array(z.union([z.number(), z.string()]).transform(Number)) });

/** Removes every file of recordings whose rows went: what the rows named, and whatever else is in their folders. */
export async function removeFiles(files: RecordingFiles, rows: readonly z.output<typeof STORED>[]): Promise<void> {
  const paths = new Set<string>();
  for (const row of rows) {
    for (const p of pathsOf({ storeId: row.store_id, id: row.id, sealed: row.sealed, seqs: row.seqs })) paths.add(p);
    for (const p of (await files.list(row.store_id, row.id)) ?? []) paths.add(p);
  }
  if (paths.size > 0) await files.remove([...paths]);
}

/**
 * Deletes the recordings a visitor's browser names, with their files (D656 8.3): no consent check, since withdrawing must work after
 * withdrawal. Returns how many went; nothing changes without Storage.
 */
export async function forgetRecordings(input: { store: string; ids: readonly string[] }, deps: RecordingDeps = {}): Promise<number> {
  const ids = input.ids.filter((id) => z.uuid().safeParse(id).success).slice(0, 51);
  if (ids.length === 0) return 0;
  const files = filesOf(deps);
  if (!files) {
    log("warn", "recordings.no_storage", { action: "forget" });
    return 0;
  }
  const store = await getOpenStore(input.store);
  if (!store) return 0;
  const gone = await typedRows(
    STORED,
    sql`delete from commerce.recordings where store_id = ${store.id}::uuid and id = any(${textList(ids)}::uuid[]) returning id, store_id, sealed, seqs`,
  );
  await removeFiles(files, gone);
  return gone.length;
}

/** Recordings older than `RECORDING_KEEP_DAYS` go with their files, every store's (a closed store's too), a batch at a time until `deadline`. */
export async function pruneRecordings(now: Date = new Date(), deadline: number = Date.now() + 60_000, deps: RecordingDeps = {}): Promise<number> {
  const files = filesOf(deps);
  if (!files) {
    log("warn", "recordings.no_storage", { action: "prune" });
    return 0;
  }
  const before = new Date(now.getTime() - RECORDING_KEEP_DAYS * 86_400_000).toISOString();
  let total = 0;
  while (Date.now() < deadline) {
    const gone = await typedRows(
      STORED,
      sql`delete from commerce.recordings where id in (
            select id from commerce.recordings where started_at < ${before}::timestamptz order by started_at limit 100
          ) returning id, store_id, sealed, seqs`,
    );
    if (gone.length === 0) break;
    await removeFiles(files, gone);
    total += gone.length;
  }
  return total;
}
