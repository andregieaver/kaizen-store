/**
 * Recordings of visits (D656, `docs/heatmaps-and-recordings.md` sections 3, 6.4 and 7.4): their limits, the folders their segments are
 * kept in, and the coarse times kept about them. Pure and browser-safe (no zod, no server module): the storefront's recorder (step 9) and
 * the server's ingest share these numbers, and `recording.test.ts` holds them to the plan.
 */

/** A recording is kept this many days, then deleted with its files (`pruneRecordings()`, the retention kind `recordings`). */
export const RECORDING_KEEP_DAYS = 30;
/** At most this many segments in one recording (`seq` 0..199). */
export const REC_MAX_SEGMENTS = 200;
/** At most this many gzipped bytes in one recording. */
export const REC_MAX_BYTES = 4_194_304;
/** At most this long, from the session's start. */
export const REC_MAX_MS = 3_600_000;
/** At most this many pages in one recording. */
export const REC_MAX_PAGES = 50;
/** At most this many events in one segment. */
export const REC_MAX_EVENTS = 50_000;
/** A segment's body, compressed or not, at most. */
export const REC_SEGMENT_MAX_BYTES = 1_048_576;
/** What a segment may unpack to (a zip bomb stops here). */
export const REC_UNPACKED_MAX_BYTES = 16 * 1024 * 1024;
/** New recordings a store may start in one day (an abuse backstop; the plan's monthly limit is the real one). */
export const RECORDINGS_PER_STORE_DAY = 2_000;
/** At most this many A/B tags on one recording. */
export const REC_MAX_TAGS = 5;
/** Times kept about a recording are floored to this many minutes: never the exact moment. */
export const REC_TIME_MINUTES = 10;

export const RECORDING_BUCKET = "recordings";

/** `seq` as its file name: three digits, `000`…`199`. */
export const seqName = (seq: number) => String(seq).padStart(3, "0");

/** The folder of one recording's files. */
export const recordingFolder = (storeId: string, id: string) => `${storeId}/${id}/`;

/** The file of one segment. */
export const segmentPath = (storeId: string, id: string, seq: number) => `${recordingFolder(storeId, id)}${seqName(seq)}.gz`;

/** The one file of a sealed recording. */
export const sealedPath = (storeId: string, id: string) => `${recordingFolder(storeId, id)}all.gz`;

/** Every file a recording's row says it has: the sealed file, or one per kept segment. */
export function pathsOf(row: { storeId: string; id: string; sealed: boolean; seqs: readonly number[] }): string[] {
  return row.sealed ? [sealedPath(row.storeId, row.id)] : [...row.seqs].sort((a, b) => a - b).map((seq) => segmentPath(row.storeId, row.id, seq));
}

/** A moment floored to `REC_TIME_MINUTES`. */
export function coarseTime(at: Date): Date {
  const step = REC_TIME_MINUTES * 60_000;
  return new Date(Math.floor(at.getTime() / step) * step);
}

/** A viewport size rounded to 10 CSS px, kept between 0 and 9,990. */
export const coarseSize = (px: number) => Math.max(0, Math.min(9990, Math.round(px / 10) * 10));

/**
 * The pages a recording has visited, with the new ones appended: the last is never repeated, and at most `REC_MAX_PAGES` are kept
 * (the first ones, so the entry page stays).
 */
export function appendPages(pages: readonly string[], more: readonly string[]): string[] {
  const out = [...pages];
  for (const page of more) if (out[out.length - 1] !== page) out.push(page);
  return out.slice(0, REC_MAX_PAGES);
}
