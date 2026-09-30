"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  PENDING_KEY,
  alertKey,
  chimeFrequencies,
  optimisticTimer,
  parseFired,
  reconcileTimer,
  serialiseFired,
  stopMinutes,
  timerAlert,
  timerElapsedMs,
  timerFromServer,
  type ClientTimer,
  type PendingEntry,
  type TimerSync,
  type TimerTarget,
} from "@/lib/work-timer-ui";
import { formatDuration } from "@/lib/work-time";
import type { RunningTimer } from "@/server/work-time";

import {
  discardTimerAction,
  runningTimerAction,
  startTimerAction,
  stopTimerAction,
} from "@/app/admin/(gated)/(owner)/account/work/s/[store]/actions";

/**
 * The running timer as the page shows it, ahead of the server (docs/work.md
 * 1.7, from Life's `use-work-timer.ts`). One per person across all their
 * stores (D123): it carries the store it runs in, and starting one in another
 * store stops and logs this one.
 *
 * The timer is a row in the database, so it survives a reload and shows on
 * every device; this hook is the browser's view of it. Pressing start or stop
 * changes the view at once and the server catches up behind: the clock stops
 * as it is pressed, the minutes it measured show as already logged, and a read
 * that lands while the press is still on its way (which still shows the old
 * clock) is ignored (`reconcileTimer`). The server is read again when the
 * window gets focus or becomes visible and once a minute, so a timer started
 * or stopped on another device shows up here. The server's time is taken from
 * the read, so a computer whose clock is off still counts right.
 */

// --- A clock that ticks --------------------------------------------------------------

let tick = 0;
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;

/** One clock for every component that shows a running time; it stops (and reads 0) when nobody is looking. */
const subscribeTick = (notify: () => void): (() => void) => {
  listeners.add(notify);
  if (listeners.size === 1) {
    tick = Date.now();
    ticker = setInterval(() => {
      tick = Date.now();
      listeners.forEach((listener) => listener());
    }, 1000);
  }
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0) {
      clearInterval(ticker);
      tick = 0;
    }
  };
};
const readTick = () => tick;
const serverTick = () => 0;
const noSubscription = (): (() => void) => () => {};

/**
 * The time now in ms, every second, while `active`; 0 on the server and
 * before the first tick (`timerElapsedMs` then shows what the server read),
 * and while not active (nothing ticks for a page with no clock to show).
 */
export function useNow(active: boolean): number {
  const now = useSyncExternalStore(active ? subscribeTick : noSubscription, readTick, serverTick);
  return active ? now : 0;
}

// --- Storage and sound, which may not be there ------------------------------------------

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private mode or blocked: the warning still fires, and may fire again after a reload
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* as above */
  }
}

/**
 * A short chime from the Web Audio API: no asset to load, and it works
 * offline. Browsers only let audio start after a press; starting the timer was
 * one, so by the time this fires the page is allowed to sound.
 */
export function playChime(stage: "near" | "over"): void {
  try {
    const Context =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    chimeFrequencies(stage).forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const at = context.currentTime + index * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.18);
    });
    setTimeout(() => void context.close().catch(() => {}), 1000);
  } catch {
    /* no audio device, or blocked: the popup, if on, still shows */
  }
}

// --- The hook -----------------------------------------------------------------------------

export type TimerAlert = { stage: "near" | "over"; timer: ClientTimer };

export type WorkTimer = {
  /** The person works in more than one store with Work on, so the bar says which one a timer runs in. */
  showStore: boolean;
  timer: ClientTimer | null;
  /** Minutes of a clock just stopped, shown as logged until the server's figures include them. */
  pendingEntry: PendingEntry | null;
  /** The time now while a clock (or a stop being logged) is on screen, else 0. */
  now: number;
  start: (target: TimerTarget) => void;
  stop: () => void;
  /** Throws the running timer away without logging it (one started by mistake). */
  discard: () => void;
  /** A press is on its way to the server. */
  busy: boolean;
  /** What happened, for a live region ("Timer stopped. 12m logged."). */
  status: string;
  /** Why the last press did not work. */
  error: string | null;
  dismissError: () => void;
  /** The estimate warning that is up, if any. */
  alert: TimerAlert | null;
  dismissAlert: () => void;
};

const CHECK_MS = 5000;
const REREAD_MS = 60_000;

export function useWorkTimer({
  showStore,
  accountId,
  serverTimer,
}: {
  showStore: boolean;
  accountId: string;
  serverTimer: RunningTimer | null;
}): WorkTimer {
  const [sync, setSync] = useState<TimerSync>(() => ({
    timer: serverTimer ? timerFromServer(serverTimer, Date.now()) : null,
    stopping: null,
    pendingEntry: null,
  }));
  const latest = useRef(sync);
  useEffect(() => {
    latest.current = sync;
  }, [sync]);

  // A new render of the page from the server (after an action, or a refresh) brings the server's timer.
  const [seen, setSeen] = useState(serverTimer);
  if (serverTimer !== seen) {
    setSeen(serverTimer);
    setSync((current) => reconcileTimer(current, serverTimer, Date.now()));
  }

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<TimerAlert | null>(null);

  const reread = useCallback(async () => {
    try {
      const server = await runningTimerAction();
      setSync((current) => reconcileTimer(current, server, Date.now()));
    } catch {
      /* offline: the view stays as it is and is read again later */
    }
  }, []);

  // Somebody may have started or stopped a timer somewhere else.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") void reread();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    const id = setInterval(again, REREAD_MS);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
      clearInterval(id);
    };
  }, [reread]);

  const start = useCallback(
    (target: TimerTarget) => {
      const before = latest.current;
      const now = Date.now();
      const previous = before.timer && before.timer.key !== PENDING_KEY ? before.timer : null;
      setError(null);
      setBusy(true);
      // Starting stops and logs the clock that ran, so its minutes show as logged at once.
      setSync({
        timer: optimisticTimer(accountId, target, now),
        stopping: previous ? previous.key : before.stopping,
        pendingEntry: previous
          ? {
              assignmentId: previous.assignmentId,
              taskId: previous.taskId,
              minutes: stopMinutes(timerElapsedMs(previous, now)),
            }
          : before.pendingEntry,
      });
      startTimerAction(target.storeSlug, target.assignmentId, target.taskId)
        .then((result) => {
          if (!result.ok) {
            setSync(before);
            setError(result.problems.join(" "));
            return;
          }
          setStatus(
            result.stopped
              ? `Timer started. ${formatDuration(result.stopped.minutes)} logged on the one before.`
              : "Timer started.",
          );
          setSync((current) =>
            current.timer?.key === PENDING_KEY && current.timer
              ? { ...current, timer: { ...current.timer, key: result.startedAt } }
              : current,
          );
          return reread();
        })
        .catch(() => {
          setSync(before);
          setError("The timer could not be started. Check your connection and try again.");
        })
        .finally(() => setBusy(false));
    },
    [accountId, reread],
  );

  const stop = useCallback(() => {
    const before = latest.current;
    const running = before.timer;
    if (!running || running.key === PENDING_KEY) return;
    const minutes = stopMinutes(timerElapsedMs(running, Date.now()));
    setError(null);
    setBusy(true);
    setSync({
      timer: null,
      stopping: running.key,
      pendingEntry: { assignmentId: running.assignmentId, taskId: running.taskId, minutes },
    });
    stopTimerAction(running.storeSlug)
      .then((result) => {
        if (!result.ok) {
          setSync(before);
          setError(result.problems.join(" "));
          return;
        }
        setStatus(
          result.entry
            ? `Timer stopped. ${formatDuration(result.entry.minutes)} logged on ${running.taskTitle ?? running.assignmentName}.`
            : "There was no timer running.",
        );
        if (result.capped) {
          setError(
            "The timer had been running for more than 24 hours, so 24 hours were logged. Correct the entry under Time.",
          );
        }
        return reread();
      })
      .catch(() => {
        setSync(before);
        setError("The timer could not be stopped. Check your connection and try again.");
      })
      .finally(() => setBusy(false));
  }, [reread]);

  const discard = useCallback(() => {
    const before = latest.current;
    const running = before.timer;
    if (!running || running.key === PENDING_KEY) return;
    setError(null);
    setBusy(true);
    setSync({ timer: null, stopping: running.key, pendingEntry: null });
    discardTimerAction(running.storeSlug)
      .then((result) => {
        if (!result.ok) {
          setSync(before);
          setError(result.problems.join(" "));
          return;
        }
        setStatus("Timer discarded. Nothing was logged.");
        return reread();
      })
      .catch(() => {
        setSync(before);
        setError("The timer could not be discarded. Check your connection and try again.");
      })
      .finally(() => setBusy(false));
  }, [reread]);

  // Estimate warnings, while the page is open: each stage once per running timer.
  const { timer } = sync;
  useEffect(() => {
    if (!timer?.estimate) return;
    const check = () => {
      const key = alertKey(timer);
      const fired = parseFired(readStored(key));
      const stage = timerAlert(timer, Date.now(), fired);
      if (!stage || !timer.estimate) return;
      fired.add(stage);
      writeStored(key, serialiseFired(fired));
      if (timer.estimate.settings.sound) playChime(stage);
      if (timer.estimate.settings.popup) setAlert({ stage, timer });
    };
    const first = setTimeout(check, 0);
    const id = setInterval(check, CHECK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [timer]);

  const dismissError = useCallback(() => setError(null), []);
  const dismissAlert = useCallback(() => setAlert(null), []);
  const now = useNow(sync.timer !== null || sync.pendingEntry !== null);

  return {
    showStore,
    timer: sync.timer,
    pendingEntry: sync.pendingEntry,
    now,
    start,
    stop,
    discard,
    busy,
    status,
    error,
    dismissError,
    alert,
    dismissAlert,
  };
}
