/**
 * One page view's heatmap summary in the browser (D656, `docs/heatmaps-and-recordings.md` 7.3). The view lives in this module, not in a
 * component, so it outlives the cart drawer unmounting the signals; it keeps the path, device and A/B versions it started with, and ending
 * it reads nothing new from the page (by then the screen shows the next one). Sent by `sendBeacon`: the first summary counts the view, later
 * ones add attention, clicks and flags.
 */

import { AB_SHOWN_EVENT, shownVersions } from "@/lib/ab-shown";
import type { Verdict } from "@/lib/click-signals";
import { attentionDelta, attentionTick, newAttention, NO_REACH, reachBucket, reachStep, type AttentionState, type ReachState } from "@/lib/heat-collect";
import { HEAT_ENDPOINT, heatBody, IDLE_MS, MIN_VIEW_MS, TICK_MS, type HeatClick, type HeatDevice } from "@/lib/page-heat";

type View = {
  store: string;
  endpoint: string;
  path: string;
  device: HeatDevice;
  startedAt: number;
  visibleMs: number;
  visibleSince: number | null;
  seq: number;
  reach: ReachState;
  att: AttentionState;
  clicks: HeatClick[];
  /** Flags this view has, and those already sent. */
  had: { dead: boolean; rage: boolean };
  sent: { dead: boolean; rage: boolean };
  tags: Map<string, string>;
};

let view: View | null = null;
let ticker: number | null = null;
let lastInput = 0;
let lastScrollSample = 0;
const off: (() => void)[] = [];

const now = () => Date.now();
const visible = () => document.visibilityState === "visible";

function measure(v: View) {
  v.reach = reachStep(v.reach, { scrollY: window.scrollY, innerHeight: window.innerHeight, scrollHeight: document.documentElement.scrollHeight });
}

function addTags(v: View) {
  if (location.pathname !== v.path) return;
  for (const [experiment, version] of shownVersions()) v.tags.set(experiment, version);
}

function tick() {
  const v = view;
  if (!v) return;
  measure(v);
  v.att = attentionTick(v.att, { scrollY: window.scrollY, innerHeight: window.innerHeight, active: now() - lastInput <= IDLE_MS, visible: visible() });
}

const onInput = () => {
  lastInput = now();
};
const onScroll = () => {
  lastInput = now();
  if (view && now() - lastScrollSample >= 200) {
    lastScrollSample = now();
    measure(view);
  }
};
const onShown = () => {
  if (view) addTags(view);
};

function ensureListeners() {
  if (off.length > 0) return;
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart"] as const) {
    window.addEventListener(type, onInput, { passive: true, capture: true });
    off.push(() => window.removeEventListener(type, onInput, { capture: true }));
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener(AB_SHOWN_EVENT, onShown);
  off.push(() => window.removeEventListener("scroll", onScroll), () => window.removeEventListener(AB_SHOWN_EVENT, onShown));
  ticker = window.setInterval(tick, TICK_MS);
}

function removeListeners() {
  for (const stop of off.splice(0)) stop();
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
}

/** The view open now: its path, for the signals to compare with the page. */
export const openViewPath = () => view?.path ?? null;

/** How long ago the open view started, in ms. */
export const viewAge = () => (view ? now() - view.startedAt : 0);

/**
 * Starts a view of the page now on screen. The admin's collector (D895 phase 3b) passes its own endpoint and the screen's key as the path,
 * so no address of the admin leaves the browser.
 */
export function startView(store: string, device: HeatDevice, at: { endpoint?: string; path?: string } = {}): void {
  const t = now();
  view = {
    store,
    endpoint: at.endpoint ?? HEAT_ENDPOINT,
    path: at.path ?? location.pathname,
    device,
    startedAt: t,
    visibleMs: 0,
    visibleSince: visible() ? t : null,
    seq: 0,
    reach: NO_REACH,
    att: newAttention(),
    clicks: [],
    had: { dead: false, rage: false },
    sent: { dead: false, rage: false },
    tags: new Map(),
  };
  lastInput = t;
  measure(view);
  ensureListeners();
  // The first versions a tick later: by then the previous page's marker has gone and this page's has registered.
  const started = view;
  window.setTimeout(() => {
    if (view === started) addTags(started);
  }, 0);
}

/** The click watch's verdicts, for the open view. */
export function addVerdicts(verdicts: Verdict[]): void {
  const v = view;
  if (!v) return;
  for (const verdict of verdicts) {
    v.clicks.push([verdict.anchor, verdict.cx, verdict.cy, verdict.dead ? 1 : 0, verdict.rage ? 1 : 0]);
    if (verdict.dead) v.had.dead = true;
    if (verdict.rage) v.had.rage = true;
  }
}

/** Notes that the tab was hidden or shown, for the view's visible time. */
export function visibilityChanged(): void {
  const v = view;
  if (!v) return;
  if (visible()) v.visibleSince ??= now();
  else if (v.visibleSince !== null) {
    v.visibleMs += now() - v.visibleSince;
    v.visibleSince = null;
  }
}

/** Sends what the view has gathered since its last summary; false when nothing was sent (too short, or the browser refused). */
export function summarise(): boolean {
  const v = view;
  if (!v) return false;
  const shown = v.visibleMs + (v.visibleSince !== null ? now() - v.visibleSince : 0);
  if (shown < MIN_VIEW_MS) return false;
  const first = v.seq === 0;
  const { delta, attH, next } = attentionDelta(v.att, v.reach.maxHeight);
  const dv = v.had.dead && !v.sent.dead;
  const rv = v.had.rage && !v.sent.rage;
  const body = heatBody({
    store: v.store,
    path: v.path,
    seq: v.seq,
    device: v.device,
    ...(first ? { reach: reachBucket(v.reach, window.innerHeight), fold: v.reach.fold ?? 1000, attH } : {}),
    att: delta,
    clicks: v.clicks,
    dv: dv ? 1 : 0,
    rv: rv ? 1 : 0,
    fv: (dv || rv) && !v.sent.dead && !v.sent.rage ? 1 : 0,
    ab: [...v.tags.entries()],
  });
  let ok = false;
  try {
    ok = navigator.sendBeacon(v.endpoint, new Blob([JSON.stringify(body)], { type: "text/plain" }));
  } catch {
    ok = false;
  }
  if (!ok) return false;
  v.seq += 1;
  v.att = next;
  v.clicks = [];
  if (dv) v.sent.dead = true;
  if (rv) v.sent.rage = true;
  return true;
}

/** Ends the view: its last summary, then nothing more. */
export function endView(): void {
  summarise();
  view = null;
}

/** Drops the view without sending anything (consent withdrawn), and stops listening. */
export function discardView(): void {
  view = null;
  removeListeners();
}
