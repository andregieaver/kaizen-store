import { record } from "@rrweb/record";

import { AB_SHOWN_EVENT, shownVersions } from "@/lib/ab-shown";
import type { HeatDevice } from "@/lib/page-heat";
import {
  ADMIN_REC_ENDPOINT,
  addId,
  adminRecorderOptions,
  idsKey,
  readSession,
  recorderOptions,
  REC_FLUSH_MS,
  REC_MAX_BUFFER,
  REC_MAX_BYTES,
  REC_MAX_PAGES,
  REC_MAX_SEGMENTS,
  REC_MIN_MS,
  REC_TAIL_MAX_BYTES,
  sessionFor,
  sessionKey,
  type RecSession,
} from "@/lib/recording";
import { signalPlace } from "@/lib/signal-paths";

/**
 * The storefront's recorder of visits (D656, `docs/heatmaps-and-recordings.md` 7.4): rrweb, loaded only for a tab that is sampled, on a
 * page recordings may see, for a visitor who allowed them. Every event is checked as it comes: on a page that may not be recorded it is
 * dropped and the recorder pauses; a Meta event's address loses its query; times become relative to the session's start, so no clock time
 * leaves the browser. Segments go up gzipped once the session has lasted 5 s and had an interaction: at once after a full snapshot,
 * otherwise every 30 s; a tail goes by beacon as the page goes away. The server's answer steers it (section 7.4's table).
 */

export type Event = { type: number; timestamp: number; data?: unknown };
/**
 * Where the recorder runs: a store, or the admin (D895 phase 3b), where `admin.screen()` names the screen on show by its key (null for a
 * screen never measured), each event is scrubbed of every word and address before it is buffered (`admin.scrub`, the server scrubs
 * again), segments go to the admin's own endpoint, pictures are blocked, and no id is kept for forgetting (an admin recording is joined to
 * no one).
 */
export type RecorderStore = { id: string; slug: string; share: number; mask: "balanced" | "strict"; device: HeatDevice; admin?: { screen: () => string | null; scrub: (event: Event) => Event | null | undefined } };

let store: RecorderStore | null = null;
let session: RecSession | null = null;
let stopRrweb: (() => void) | undefined;
let recording = false;
let buffer: Event[] = [];
let pages: string[] = [];
let counts = { clicks: 0, dead: 0, rage: 0 };
let size = { w: 0, h: 0 };
let interacted = false;
let lastSent = 0;
let bytesSent = 0;
let uploading = false;
let needFull = false;
let ticker: number | null = null;
let aborter: AbortController | null = null;
let listening = false;

const now = () => Date.now();
const storage = (kind: "session" | "local") => {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

function save() {
  if (store && session) storage("session")?.setItem(sessionKey(store.id), JSON.stringify(session));
}

/** Ends recording for this tab session: nothing more is recorded until a new session starts. */
function end() {
  if (session) {
    session.sampled = false;
    save();
  }
  halt();
  buffer = [];
}

function halt() {
  stopRrweb?.();
  stopRrweb = undefined;
  recording = false;
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
}

const allowedHere = () =>
  Boolean(store && (store.admin ? store.admin.screen() !== null : signalPlace(window.location.pathname, window.location.search, store.slug)?.rec));

function emit(raw: Event) {
  if (!store || !session) return;
  // History changes before rrweb sends the next page's mutations, so this sees the page the event belongs to.
  if (!allowedHere()) {
    pause(false);
    return;
  }
  // In the admin, undefined is an event dropped on purpose; null one from a screen never measured, which pauses.
  const timed: Event = { ...raw, timestamp: Math.max(0, raw.timestamp - session.started) };
  const event = store.admin ? store.admin.scrub(timed) : timed;
  if (event === undefined) return;
  if (event === null) {
    pause(false);
    return;
  }
  if (!store.admin && event.type === 4 && event.data && typeof event.data === "object") event.data = { ...(event.data as object), href: `${window.location.origin}${window.location.pathname}` };
  buffer.push(event);
  if (buffer.length > REC_MAX_BUFFER) {
    end();
    return;
  }
  if (event.type === 2 && qualified()) void send();
}

function qualified(): boolean {
  if (!session) return false;
  if (!session.qualified && interacted && now() - session.started >= REC_MIN_MS) {
    session.qualified = true;
    save();
  }
  return session.qualified;
}

function body(events: Event[]) {
  return JSON.stringify({
    v: 1,
    meta: { device: store!.device, w: size.w, h: size.h, pages, clicks: counts.clicks, dead: counts.dead, rage: counts.rage, ab: shownVersions().slice(0, 5) },
    events,
  });
}

const segmentUrl = (z: 0 | 1) =>
  store!.admin
    ? `${ADMIN_REC_ENDPOINT}?id=${session!.id}&seq=${session!.seq}&z=${z}`
    : `/api/signals/rec?store=${encodeURIComponent(store!.slug)}&id=${session!.id}&seq=${session!.seq}&z=${z}`;

/** Before a recording's first upload, its id is kept so the visitor can delete it later. */
function keepId() {
  const local = storage("local");
  if (!local || !store || !session || store.admin) return;
  local.setItem(idsKey(store.id), JSON.stringify(addId(local.getItem(idsKey(store.id)), session.id, session.started, now())));
}

function sent(bytes: number) {
  session!.seq += 1;
  bytesSent += bytes;
  pages = [];
  counts = { clicks: 0, dead: 0, rage: 0 };
  lastSent = now();
  save();
  if (session!.seq >= REC_MAX_SEGMENTS || bytesSent >= REC_MAX_BYTES) end();
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

/** Sends what is buffered as a segment; the next seq only after the server kept it. */
async function send(): Promise<void> {
  if (!store || !session || !session.sampled || uploading || buffer.length === 0 || !qualified()) return;
  const events = buffer;
  buffer = [];
  const hadFull = events.some((e) => e.type === 2);
  uploading = true;
  aborter = new AbortController();
  try {
    keepId();
    const blob = await gzip(body(events));
    const answer = await fetch(segmentUrl(1), { method: "POST", body: blob, headers: { "Content-Type": "application/gzip" }, signal: aborter.signal, keepalive: false });
    if (answer.status === 204) sent(blob.size);
    else if (answer.status === 410 || answer.status === 400) end();
    else if (hadFull) needFull = true;
  } catch {
    if (hadFull) needFull = true;
  } finally {
    uploading = false;
    aborter = null;
  }
  if (needFull && recording) {
    needFull = false;
    record.takeFullSnapshot();
  }
}

/** What is buffered, as a beacon while the page goes away (at most 60,000 bytes; more is dropped and a snapshot taken if the page stays). */
function sendTail() {
  if (!store || !session || !session.sampled || buffer.length === 0 || !qualified()) return;
  const text = body(buffer);
  if (new TextEncoder().encode(text).length > REC_TAIL_MAX_BYTES) {
    buffer = [];
    needFull = true;
    return;
  }
  keepId();
  // The beacon's answer is never known: the seq moves on, and a gap in the row's segments is the only trace of a lost tail.
  if (navigator.sendBeacon(segmentUrl(0), new Blob([text], { type: "text/plain" }))) {
    buffer = [];
    sent(text.length);
  }
}

function tick() {
  if (!qualified()) return;
  if (now() - lastSent >= REC_FLUSH_MS || buffer.some((e) => e.type === 2)) void send();
}

const onInput = () => {
  interacted = true;
  if (session) session.lastInput = now();
};
const onShown = () => {
  if (recording) record.addCustomEvent("kz-ab", { tags: shownVersions() });
};

function listen() {
  if (listening) return;
  listening = true;
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const) window.addEventListener(type, onInput, { passive: true, capture: true });
  window.addEventListener(AB_SHOWN_EVENT, onShown);
}

function unlisten() {
  if (!listening) return;
  listening = false;
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const) window.removeEventListener(type, onInput, { capture: true });
  window.removeEventListener(AB_SHOWN_EVENT, onShown);
}

/**
 * Records this page, a page the signals found allowed: starts the tab's session (or continues it), or resumes after a pause with a new full
 * snapshot. Does nothing for a tab that is not sampled. Returns whether it records.
 */
export function recordPage(next: RecorderStore, path: string): boolean {
  const s = storage("session");
  if (!s) return false;
  store = next;
  session = sessionFor(readSession(s.getItem(sessionKey(next.id))), now(), next.share, () => crypto.randomUUID(), Math.random());
  save();
  if (!session.sampled) return false;
  if (session.pages >= REC_MAX_PAGES) {
    end();
    return false;
  }
  if (!recording) {
    size = { w: window.innerWidth, h: window.innerHeight };
    lastSent = lastSent || now();
    listen();
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    stopRrweb = record({ ...(next.admin ? adminRecorderOptions(touch) : recorderOptions(next.mask, touch)), emit: (e) => emit(e as Event), errorHandler: () => true });
    recording = stopRrweb !== undefined;
    if (!recording) return false;
    ticker = window.setInterval(tick, 5_000);
  }
  if (pages[pages.length - 1] !== path) {
    pages.push(path);
    session.pages += 1;
    save();
    record.addCustomEvent("kz-page", { path });
  }
  return true;
}

/** Clicks the click watch judged, for the segment's counts and the timeline. */
export function noteClicks(verdicts: readonly { dead: boolean; rage: boolean; cx: number; cy: number }[]): void {
  if (!recording) return;
  for (const v of verdicts) {
    counts.clicks += 1;
    if (v.dead) counts.dead += 1;
    if (v.rage) counts.rage += 1;
    if (v.dead || v.rage) record.addCustomEvent("kz-click", { dead: v.dead, rage: v.rage, x: v.cx, y: v.cy });
  }
}

/** Pauses: what is buffered goes up (as a tail when the page is going away), and rrweb stops until the next allowed page. */
export function pause(leaving: boolean): void {
  if (!recording && buffer.length === 0) return;
  halt();
  unlisten();
  if (leaving) sendTail();
  else void send();
}

/** The tab is hidden: a tail now, recording goes on. */
export function hidden(): void {
  if (recording) sendTail();
}

/** Consent withdrawn: nothing buffered is sent, an upload in flight is stopped, and recording ends. */
export function discard(): void {
  buffer = [];
  aborter?.abort();
  halt();
  unlisten();
  store = null;
  session = null;
}

/** The recording's id while one runs in this tab, for forgetting. */
export const currentId = () => session?.id ?? null;
