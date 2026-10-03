import { walk, type CaptureNode, type PageCapture, type SliderWatch } from "./replicate-capture";

/**
 * Whether a track moves by itself (D155, C2). The page is looked at once, so autoplay can only be known by looking at the tracks again: a
 * sample of each track is taken every few hundred milliseconds with nobody touching the page, and a change in what a sample says is a move.
 * What is watched is bounded in time, hard, because the replicator's tick has a limit of its own (`maxDuration` of the tick route, 300 s,
 * shared with opening the page twice and photographing it): one window, at most one more window if nothing moved in the first, and never
 * more than `WATCH.totalMs` altogether. Pure, with the clock and the browser passed in, so the bound is tested without either.
 */

export const WATCH = {
  /** Between two samples. */
  sampleMs: 350,
  /** The first window. */
  windowMs: 6500,
  /** The one retry, when nothing moved in the first window. */
  retryMs: 5000,
  /** A hard cap on everything, retry included. */
  totalMs: 12_000,
  /** Moves closer than this are one move (a slide that is animated by script changes at every frame). */
  mergeMs: 1200,
  /** A page that took longer than this to open is not watched: the tick has no time to spare. */
  skipAfterMs: 70_000,
  /** Any one call to the page (a sample, scrolling a track into view): a page that does not answer within this is lost, and the watch ends. */
  callMs: 2000,
} as const;

/**
 * Whether a track changed at nearly every sample for the whole window: something moved by script at every frame (a logo ticker, a marquee) is moving all the
 * time, not resting on one slide after another, so it has no period and is no autoplay of slides.
 */
export function movesAllTheTime(samples: { at: number; value: string }[], share = 0.7, least = 4): boolean {
  const steps = samples.length - 1;
  if (steps < least) return false;
  let changed = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i].value !== samples[i - 1].value) changed += 1;
  return changed / steps > share;
}

/** What a call to the page came to when it did not answer in time. */
export const NO_ANSWER = Symbol("no answer");

/** A promise that gives up after `ms`: `NO_ANSWER` when the page does not answer (the promise itself is left hanging; closing the page ends it). */
export async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof NO_ANSWER> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<typeof NO_ANSWER>((resolve) => (timer = setTimeout(() => resolve(NO_ANSWER), Math.max(1, ms))))]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The seconds a carousel stays on a slide, as a carousel takes it: 3 to 15. */
export const clampSeconds = (seconds: number): number => Math.min(15, Math.max(3, Math.round(seconds)));

export type Move = { at: number; last: number };

/** What the samples of one track said: one string per sample; a different string from the one before is a change. */
export function movesOf(samples: { at: number; value: string }[], mergeMs: number = WATCH.mergeMs): Move[] {
  const moves: Move[] = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].value === samples[i - 1].value) continue;
    const last = moves[moves.length - 1];
    if (last && samples[i].at - last.last <= mergeMs) last.last = samples[i].at;
    else moves.push({ at: samples[i].at, last: samples[i].at });
  }
  return moves;
}

/**
 * What the moves of a window say. Nothing moved: not observed. Two moves or more: the period is the gap between them (the median).
 * One move: the track moves by itself, with a period of at least the longer of the time before the move and the time after it, as no
 * second move came; that is a lower bound, and says so.
 */
export function watchOf(moves: Move[], watchedMs: number): SliderWatch {
  if (moves.length === 0) return { observed: false, watchedMs };
  if (moves.length >= 2) {
    const gaps = moves
      .slice(1)
      .map((move, i) => move.at - moves[i].at)
      .sort((a, b) => a - b);
    const middle = gaps.length % 2 === 1 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
    return { observed: true, watchedMs, seconds: clampSeconds(middle / 1000), moves: moves.length, basis: "interval" };
  }
  const bound = Math.max(moves[0].at, watchedMs - moves[0].at);
  return { observed: true, watchedMs, seconds: clampSeconds(Math.ceil(bound / 1000)), moves: 1, basis: "once" };
}

export type WatchDeps = {
  /** One sample of each track, by its path; null when the page cannot be read (it closed, it navigated). */
  read: () => Promise<Record<string, string> | null>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Called before each window: bring the first track into view, take the pointer away. */
  prepare?: (attempt: number) => Promise<void>;
  aborted?: () => boolean;
  /** Whether a window with nothing moving is worth one more: a script slider may wait to be looked at, a plain scroller will not. On unless false. */
  retry?: boolean;
};

export type WatchResult = { watches: Record<string, SliderWatch>; /** Windows used: 1, or 2 with the retry. */ windows: number; /** What was spent, in milliseconds. */ spentMs: number };

/**
 * Watches the tracks `paths` with `deps`. The first window ends when every track has moved twice (so its period is known) or when it is
 * spent, and is carried on past that while a track has moved once and its period is not known yet, but never past `WATCH.totalMs` from the
 * start; if no track moved at all, one more window follows, within the same total. Each track's verdict is from the window it moved in, else
 * the first window's (not observed).
 */
export async function watchTracks(paths: string[], deps: WatchDeps, limits: { windowMs: number; retryMs: number; totalMs: number; sampleMs: number; mergeMs: number; callMs?: number } = WATCH): Promise<WatchResult> {
  const begun = deps.now();
  const spent = () => deps.now() - begun;
  const watches: Record<string, SliderWatch> = {};
  let windows = 0;
  if (paths.length === 0) return { watches, windows, spentMs: 0 };
  // Every call to the page is bounded by the time the watch has left and by a short cap of its own: a page whose main thread is busy for good answers
  // nothing, and the watch (and the open that waits for it) must not wait for it.
  const callMs = limits.callMs ?? WATCH.callMs;
  const bounded = <T,>(call: Promise<T>) => within(call, Math.min(callMs, Math.max(1, limits.totalMs - spent())));
  let settled = false;
  let silent = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1 && deps.retry === false) break;
    const room = Math.min(attempt === 0 ? limits.windowMs : limits.retryMs, limits.totalMs - spent());
    // A window too short to see a second sample is not a window.
    if (room < 2 * limits.sampleMs || deps.aborted?.()) break;
    if (deps.prepare) await bounded(deps.prepare(attempt).catch(() => {}));
    const opened = deps.now();
    const firstTaken = await bounded(deps.read());
    // The page cannot be read (it closed, it went elsewhere, it does not answer): nothing more to watch.
    if (firstTaken === NO_ANSWER || !firstTaken) {
      silent = true;
      break;
    }
    const first = firstTaken;
    windows += 1;
    let lost = false;
    const samples: Record<string, { at: number; value: string }[]> = {};
    for (const path of paths) samples[path] = [{ at: 0, value: first[path] ?? "" }];
    const pending = () => paths.some((path) => movesOf(samples[path], limits.mergeMs).length === 1);
    while ((deps.now() - opened < room || pending()) && spent() < limits.totalMs && !deps.aborted?.()) {
      await deps.sleep(limits.sampleMs);
      const got = await bounded(deps.read());
      if (got === NO_ANSWER) silent = true;
      const taken = got === NO_ANSWER ? null : got;
      if (!taken) {
        lost = true;
        break;
      }
      const at = deps.now() - opened;
      for (const path of paths) samples[path].push({ at, value: taken[path] ?? "" });
      if (paths.every((path) => movesOf(samples[path], limits.mergeMs).length >= 2)) break;
    }
    const watchedMs = Math.round(deps.now() - opened);
    for (const path of paths) {
      const continuous = movesAllTheTime(samples[path]);
      const verdict: SliderWatch = continuous ? { observed: false, watchedMs, why: "it moves all the time, like a ticker, and does not rest on one slide after another" } : watchOf(movesOf(samples[path], limits.mergeMs), watchedMs);
      if (verdict.observed || continuous) settled = true;
      if (verdict.observed || continuous || !watches[path]) watches[path] = verdict;
    }
    if (settled || lost) break;
  }
  // A track the page never let be looked at is not observed, and says why (a page that does not answer is not one that does not play).
  if (silent) for (const path of paths) watches[path] ??= { observed: false, watchedMs: Math.round(spent()), why: "the page stopped answering" };
  return { watches, windows, spentMs: Math.round(spent()) };
}

/** Puts what watching found on the track nodes of a capture, by path. */
export function applyWatch(capture: PageCapture, watches: Record<string, SliderWatch>): number {
  let put = 0;
  for (const node of walk(capture.root)) {
    const found = watches[node.p];
    if (found) {
      (node as CaptureNode).watch = found;
      put += 1;
    }
  }
  return put;
}

/** The paths of the tracks worth watching: script sliders and boxes that scroll sideways by themselves, each with at least two tiles. `sliders`: those that are script sliders. */
export function trackPaths(capture: PageCapture): string[] & { sliders?: string[] } {
  const found: string[] & { sliders?: string[] } = [];
  const sliders: string[] = [];
  for (const node of walk(capture.root)) {
    if ((node.slider || node.scroll) && node.children.length >= 2) {
      found.push(node.p);
      if (node.slider) sliders.push(node.p);
    }
  }
  found.sliders = sliders;
  return found;
}

/** A line for the job's log about what watching found, or null when no track was watched. */
export function watchLine(capture: PageCapture): string | null {
  const watched = [...walk(capture.root)].filter((node) => node.watch);
  if (watched.length === 0) return null;
  const moving = watched.filter((node) => node.watch?.observed);
  const longest = Math.max(...watched.map((node) => node.watch?.watchedMs ?? 0));
  const whys = watched.map((node) => (node.watch?.observed === false ? node.watch.why : undefined));
  const noun = watched.length === 1 ? "slider" : `${watched.length} sliders`;
  if (whys.every((why) => why?.startsWith("the page took too long"))) return `Did not watch the ${noun} for autoplay: the page took too long to open to spare the time.`;
  if (whys.every((why) => why === "the page stopped answering")) return `Could not watch the ${noun} for autoplay: the page stopped answering.`;
  const seconds = (Math.round(longest / 100) / 10).toString();
  const tickers = watched.filter((node) => node.watch?.observed === false && node.watch.why?.includes("all the time")).length;
  const said = `${moving.length === 0 ? "none moved by itself" : `${moving.length === 1 ? "one moves" : `${moving.length} move`} by itself`}${tickers > 0 ? `; ${tickers === 1 ? "one moves" : `${tickers} move`} all the time, like a ticker, which is not autoplay` : ""}`;
  return `Watched ${watched.length === 1 ? "one carousel" : `${watched.length} carousels`} for up to ${seconds} s with nobody touching the page: ${said}.`;
}
