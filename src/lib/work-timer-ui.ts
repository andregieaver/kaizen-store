import type { RunningTimer, TimerEstimate } from "@/server/work-time";

import { ALERT_CHIME_NOTES, alertToRaise, timerAlertStorageKey, type EstimateStage } from "./work-estimate";
import { MAX_ENTRY_MINUTES, formatDuration } from "./work-time";

/**
 * The running timer as the browser holds it (docs/work.md 1.7, 1.8, WP6), from
 * Life's `use-work-timer.ts` and `estimate-alerts.tsx`. The timer itself is a
 * row in the database (`RunningTimer`); the browser keeps a copy on its own
 * clock: the server's time is read once with the row, and the difference to the
 * browser's clock is taken out, so a computer whose clock is wrong still counts
 * right. Pressing start or stop changes the copy at once and the server catches
 * up behind (an optimistic timer); a read that lands while a press is still on
 * its way is stale and ignored until the server agrees. Pure, so the hook, the
 * bar and the tests share the rules.
 */

/** The key of a clock between the press on start and the server's answer. */
export const PENDING_KEY = "pending";

export type TimerTarget = {
  /** The store the assignment is in: a person has one timer across all their stores (D123), so it says where it runs. */
  storeSlug: string;
  /** Null for a clock just started here, until the server's view (which names the store) is read. */
  storeName: string | null;
  assignmentId: string;
  assignmentName: string;
  clientId: string;
  clientName: string;
  taskId: string | null;
  taskTitle: string | null;
};

export type ClientTimer = TimerTarget & {
  /** The start as the server said it (a timer has no other id), or `PENDING_KEY`. */
  key: string;
  accountId: string;
  /** When it started on this browser's clock, in ms. */
  startMs: number;
  /** How long it had run when it was read, in ms: what a first render (on the server too) shows before the clock ticks. */
  initialElapsedMs: number;
  /** What the estimate warning measures against; unknown (null) for a clock just started, until the server is asked. */
  estimate: TimerEstimate | null;
};

/** The minutes a stopped timer showed while the server was still logging them. */
export type PendingEntry = { assignmentId: string; taskId: string | null; minutes: number };

/** A timer read from the server, on this browser's clock (`nowMs` is when it was read here). */
export function timerFromServer(server: RunningTimer, nowMs: number): ClientTimer {
  const startedMs = Date.parse(server.startedAt);
  const elapsedMs = Math.max(0, Date.parse(server.serverNow) - startedMs);
  return {
    key: server.startedAt,
    accountId: server.accountId,
    storeSlug: server.storeSlug,
    storeName: server.storeName,
    assignmentId: server.assignmentId,
    assignmentName: server.assignmentName,
    clientId: server.clientId,
    clientName: server.clientName,
    taskId: server.taskId,
    taskTitle: server.taskTitle,
    startMs: nowMs - elapsedMs,
    initialElapsedMs: elapsedMs,
    estimate: server.estimate,
  };
}

/** A clock started here, before the server has answered. */
export function optimisticTimer(accountId: string, target: TimerTarget, nowMs: number): ClientTimer {
  return { ...target, key: PENDING_KEY, accountId, startMs: nowMs, initialElapsedMs: 0, estimate: null };
}

/** Milliseconds a timer has run at `nowMs` (never negative); `nowMs` null is before the first tick: what it had run when read. */
export function timerElapsedMs(timer: ClientTimer, nowMs: number | null): number {
  return nowMs === null || nowMs <= 0 ? timer.initialElapsedMs : Math.max(0, nowMs - timer.startMs);
}

/** The entry a stop will make, the same rounding as the server: up to the minute, at least one, at most a day. */
export const stopMinutes = (elapsedMs: number): number =>
  Math.min(MAX_ENTRY_MINUTES, Math.max(1, Math.ceil(elapsedMs / 60_000)));

/** What the page knows about the timer between presses. */
export type TimerSync = {
  timer: ClientTimer | null;
  /** The clock (by key) being stopped: a read that still shows it is stale. */
  stopping: string | null;
  pendingEntry: PendingEntry | null;
};

/**
 * What a read of the server's timer changes. A read that still shows the
 * clock being stopped is stale, and so is one with no clock while a start is
 * on its way; both are ignored. When the server no longer has the clock that
 * was being stopped, the entry it made is in the server's figures, so the
 * minutes shown as logged meanwhile are dropped. The same clock coming back
 * keeps the instant it was started here (the display does not jump by the
 * request's delay) with the server's newer view of its estimate.
 */
export function reconcileTimer(current: TimerSync, incoming: RunningTimer | null, nowMs: number): TimerSync {
  if (incoming && current.stopping === incoming.startedAt) return current;
  if (!incoming) {
    if (current.timer?.key === PENDING_KEY) return current;
    return { timer: null, stopping: null, pendingEntry: current.stopping ? null : current.pendingEntry };
  }
  const fresh = timerFromServer(incoming, nowMs);
  const same = current.timer?.key === fresh.key;
  // A different clock than the one being stopped: the server has stopped that one (a start switches timers).
  const stopped = current.stopping !== null;
  return {
    timer:
      same && current.timer
        ? { ...fresh, startMs: current.timer.startMs, initialElapsedMs: current.timer.initialElapsedMs }
        : fresh,
    stopping: null,
    pendingEntry: stopped ? null : current.pendingEntry,
  };
}

/** Whole minutes a page adds to an assignment's or task's logged time while a clock runs on it or its stop is being logged. */
export function liveMinutes(
  timer: ClientTimer | null,
  pendingEntry: PendingEntry | null,
  nowMs: number | null,
  target: { assignmentId: string; taskId?: string | null },
): number {
  let minutes = 0;
  const matches = (assignmentId: string, taskId: string | null) =>
    assignmentId === target.assignmentId && (target.taskId === undefined || target.taskId === taskId);
  if (timer && matches(timer.assignmentId, timer.taskId)) minutes += Math.floor(timerElapsedMs(timer, nowMs) / 60_000);
  if (pendingEntry && matches(pendingEntry.assignmentId, pendingEntry.taskId)) minutes += pendingEntry.minutes;
  return minutes;
}

// --- Estimate warnings -----------------------------------------------------------------

/** Where a page remembers which stages it has raised for a timer (per person, as browsers are shared). */
export const alertKey = (timer: Pick<ClientTimer, "accountId" | "key">): string =>
  timerAlertStorageKey(`${timer.accountId}:${timer.key}`);

/** The stages remembered, from what was stored ("near,over", or one stage as Life wrote it). Anything else is none. */
export function parseFired(stored: string | null | undefined): Set<EstimateStage> {
  const stages = new Set<EstimateStage>();
  for (const part of (stored ?? "").split(",")) {
    if (part === "near" || part === "over") stages.add(part);
  }
  return stages;
}

export const serialiseFired = (fired: ReadonlySet<EstimateStage>): string => [...fired].sort().join(",");

/**
 * The warning to raise for a timer now, if any: only while a timer runs on
 * something with an estimate, warnings are on and a popup or a sound is
 * wanted, each stage once per running timer (`alertToRaise`). `extraLogged`
 * is time logged since the estimate was read.
 */
export function timerAlert(
  timer: ClientTimer | null,
  nowMs: number,
  fired: ReadonlySet<EstimateStage>,
): "near" | "over" | null {
  if (!timer?.estimate || timer.key === PENDING_KEY) return null;
  const { estimate } = timer;
  return alertToRaise({
    estimatedMinutes: estimate.estimatedMinutes,
    loggedMinutes: estimate.loggedMinutes,
    elapsedMs: timerElapsedMs(timer, nowMs),
    settings: estimate.settings,
    fired,
  });
}

/** The notes of the chime, in Hz: two rising ones for "nearly there", three for "used up". */
export function chimeFrequencies(stage: "near" | "over"): number[] {
  return [660, 880, 1100].slice(0, ALERT_CHIME_NOTES[stage]);
}

/** What the popup says: what it is about, and how much is left of what. */
export function alertMessage(
  stage: "near" | "over",
  timer: Pick<ClientTimer, "taskTitle" | "assignmentName" | "estimate">,
): { title: string; body: string } {
  const what = timer.taskTitle ?? timer.assignmentName;
  const estimate = timer.estimate ? formatDuration(timer.estimate.estimatedMinutes) : "";
  if (stage === "near") {
    return {
      title: "Nearly at the estimate",
      body: `The estimate for ${what} (${estimate}) is nearly used up.`,
    };
  }
  return {
    title: "Estimate used up",
    body: `You have used the whole estimate for ${what} (${estimate}). The timer keeps running until you stop it.`,
  };
}
