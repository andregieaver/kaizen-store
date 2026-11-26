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

/** Recordings of owners' own use of the admin (D895 phase 3b): their own bucket, one folder for all, and a day's cap against a script. */
export const ADMIN_RECORDING_BUCKET = "admin-recordings";
export const ADMIN_RECORDING_FOLDER = "admin";
export const ADMIN_RECORDINGS_PER_DAY = 500;
export const ADMIN_REC_ENDPOINT = "/api/admin-use/rec";

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

// ---------------------------------------------------------------------------
// The tab's session and the recorder's options (step 9, section 7.4)
// ---------------------------------------------------------------------------

/** A tab's recording ends after this long without input. */
export const REC_IDLE_MS = 1_800_000;
/** Nothing is uploaded before a session has lasted this long and had one interaction. */
export const REC_MIN_MS = 5_000;
/** A tail sent as the page goes away, at most (a beacon's keepalive budget is 64 KiB for the whole page). */
export const REC_TAIL_MAX_BYTES = 60_000;
/** Events waiting in memory past this many mean a runaway page: the recording stops. */
export const REC_MAX_BUFFER = 20_000;
/** Without a full snapshot waiting, a segment is sent this often. */
export const REC_FLUSH_MS = 30_000;
/** Ids kept for deleting live this long, and at most this many. */
export const REC_ID_DAYS = 31;
export const REC_MAX_IDS = 50;

export const sessionKey = (storeId: string) => `kaizen_replay_${storeId}`;
export const idsKey = (storeId: string) => `kaizen_replay_ids_${storeId}`;

/** What `sessionStorage` keeps for a tab: its recording's id, the next seq, whether it is sampled, its times, pages and if it qualified. */
export type RecSession = { v: 1; id: string; seq: number; sampled: boolean; started: number; lastInput: number; pages: number; qualified: boolean };

/** Reads a stored session, or null for anything that is not one. */
export function readSession(text: string | null): RecSession | null {
  if (!text) return null;
  try {
    const s = JSON.parse(text) as Partial<RecSession>;
    if (s.v !== 1 || typeof s.id !== "string" || !/^[0-9a-f-]{36}$/.test(s.id)) return null;
    if (![s.seq, s.started, s.lastInput, s.pages].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return { v: 1, id: s.id, seq: s.seq!, sampled: s.sampled === true, started: s.started!, lastInput: s.lastInput!, pages: s.pages!, qualified: s.qualified === true };
  } catch {
    return null;
  }
}

/**
 * The tab's session now: the stored one while it lasts, or a new one (a new id, sampled once by the store's share) when there is none,
 * it has had no input for `REC_IDLE_MS`, or it began over `REC_MAX_MS` ago. `random` is in [0, 1).
 */
export function sessionFor(stored: RecSession | null, now: number, share: number, newId: () => string, random: number): RecSession {
  if (stored && now - stored.lastInput < REC_IDLE_MS && now - stored.started < REC_MAX_MS) return stored;
  return { v: 1, id: newId(), seq: 0, sampled: random * 100 < share, started: now, lastInput: now, pages: 0, qualified: false };
}

/** The ids kept for deleting, with one more (until 31 days after its start), the expired ones dropped and at most 50 kept. */
export function addId(text: string | null, id: string, started: number, now: number): { id: string; until: number }[] {
  let list: { id: string; until: number }[] = [];
  try {
    const parsed = JSON.parse(text ?? "[]") as unknown;
    if (Array.isArray(parsed)) list = parsed.filter((e): e is { id: string; until: number } => typeof e?.id === "string" && typeof e?.until === "number");
  } catch {
    list = [];
  }
  const kept = list.filter((e) => e.until > now && e.id !== id);
  return [...kept, { id, until: started + REC_ID_DAYS * 86_400_000 }].slice(-REC_MAX_IDS);
}

/** The ids a browser holds for deleting, from the stored list (expired ones too: deleting them costs nothing). */
export function idsOf(text: string | null): string[] {
  try {
    const parsed = JSON.parse(text ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map((e) => (e as { id?: unknown })?.id).filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)) : [];
  } catch {
    return [];
  }
}

/**
 * rrweb's options for a store's mask (`balanced` masks the text marked `data-kz-mask`, `strict` all text): every field is masked to
 * nothing (not even the length typed), private parts are blocked, masked text is three dots whatever its length, and nothing heavy or
 * cross-origin is recorded.
 */
export function recorderOptions(mask: "balanced" | "strict", isTouch: boolean) {
  return {
    maskAllInputs: true,
    maskInputOptions: { password: true },
    maskInputFn: () => "",
    maskTextSelector: mask === "strict" ? "*" : "[data-kz-mask]",
    maskTextFn: (text: string) => (text.trim() === "" ? text : "•••"),
    blockSelector: "[data-kz-private]",
    slimDOMOptions: "all" as const,
    inlineStylesheet: true,
    inlineImages: false,
    collectFonts: false,
    recordCanvas: false,
    recordCrossOriginIframes: false,
    sampling: { mousemove: isTouch ? 150 : 50, scroll: 150, media: 800, input: "last" as const },
  };
}

/**
 * rrweb's options in the admin (D895 phase 3b): the strict mask (every text node three dots), every field masked to nothing, and pictures,
 * video and frames blocked as well as private parts, so a product's or a shopper's picture is never drawn. The server scrubs again.
 */
export function adminRecorderOptions(isTouch: boolean) {
  return { ...recorderOptions("strict", isTouch), blockSelector: "[data-kz-private], img, picture, video, iframe, canvas" };
}

// ---------------------------------------------------------------------------
// The player's timeline (step 11)
// ---------------------------------------------------------------------------

export type TimelineMark = { at: number; kind: "page" | "dead" | "rage" | "click"; path?: string };

/** The player's marks: each page (`kz-page`) and each dead or rage click (`kz-click`), by time from the start, in order. */
export function timelineMarks(events: readonly unknown[]): TimelineMark[] {
  const marks: TimelineMark[] = [];
  for (const raw of events) {
    const event = raw as { type?: unknown; timestamp?: unknown; data?: { tag?: unknown; payload?: Record<string, unknown> } };
    if (event.type !== 5 || typeof event.timestamp !== "number" || !event.data) continue;
    const payload = event.data.payload ?? {};
    if (event.data.tag === "kz-page" && typeof payload.path === "string") marks.push({ at: event.timestamp, kind: "page", path: payload.path });
    if (event.data.tag === "kz-click") marks.push({ at: event.timestamp, kind: payload.rage === true ? "rage" : payload.dead === true ? "dead" : "click" });
  }
  return marks.sort((a, b) => a.at - b.at);
}
