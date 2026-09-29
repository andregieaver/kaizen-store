import { describe, expect, it } from "vitest";

import type { RunningTimer } from "@/server/work-time";

import {
  PENDING_KEY,
  alertKey,
  alertMessage,
  chimeFrequencies,
  liveMinutes,
  optimisticTimer,
  parseFired,
  reconcileTimer,
  serialiseFired,
  stopMinutes,
  timerAlert,
  timerElapsedMs,
  timerFromServer,
  type ClientTimer,
  type TimerSync,
  type TimerTarget,
} from "./work-timer-ui";

const MIN = 60_000;
const STARTED = "2026-09-29T10:00:00.000Z";
const NOW_SERVER = "2026-09-29T10:12:30.000Z"; // 12 min 30 s later on the server's clock

const target: TimerTarget = {
  assignmentId: "a1",
  assignmentName: "Website",
  clientId: "c1",
  clientName: "Acme",
  taskId: "t1",
  taskTitle: "Design",
};

const server = (over: Partial<RunningTimer> = {}): RunningTimer => ({
  accountId: "me",
  assignmentId: "a1",
  assignmentName: "Website",
  clientId: "c1",
  clientName: "Acme",
  taskId: "t1",
  taskTitle: "Design",
  startedAt: STARTED,
  serverNow: NOW_SERVER,
  elapsedSeconds: 750,
  estimate: null,
  ...over,
});

const withEstimate = (estimatedMinutes: number, loggedMinutes: number, minutes: number | null = 10) =>
  server({
    estimate: {
      target: "task",
      estimatedMinutes,
      loggedMinutes,
      remainingAtStartMinutes: estimatedMinutes - loggedMinutes,
      settings: { minutes, popup: true, sound: false },
      stage: "ok",
      alert: null,
    },
  });

describe("a timer on the browser's own clock", () => {
  it("takes the server's time out, so a wrong computer clock still counts right", () => {
    // The browser thinks it is 1 hour later than the server does.
    const browserNow = Date.parse(NOW_SERVER) + 60 * MIN;
    const timer = timerFromServer(server(), browserNow);
    expect(timer.initialElapsedMs).toBe(750_000);
    expect(timerElapsedMs(timer, browserNow)).toBe(750_000);
    expect(timerElapsedMs(timer, browserNow + 5000)).toBe(755_000);
  });

  it("shows what the server read until the clock ticks, and never a negative time", () => {
    const timer = timerFromServer(server(), 1_000_000);
    expect(timerElapsedMs(timer, null)).toBe(750_000);
    expect(timerElapsedMs(timer, 0)).toBe(750_000);
    expect(timerElapsedMs(timer, 500)).toBe(0);
  });

  it("starts an optimistic timer at zero with no estimate yet", () => {
    const timer = optimisticTimer("me", target, 5000);
    expect(timer).toMatchObject({ key: PENDING_KEY, accountId: "me", taskId: "t1", startMs: 5000, estimate: null });
    expect(timerElapsedMs(timer, 65_000)).toBe(60_000);
  });

  it("rounds a stop up to the minute, at least one and at most a day (the server's rule)", () => {
    expect(stopMinutes(0)).toBe(1);
    expect(stopMinutes(1000)).toBe(1);
    expect(stopMinutes(60_000)).toBe(1);
    expect(stopMinutes(60_001)).toBe(2);
    expect(stopMinutes(750_000)).toBe(13);
    expect(stopMinutes(3 * 24 * 60 * MIN)).toBe(1440);
  });
});

const sync = (over: Partial<TimerSync> = {}): TimerSync => ({
  timer: null,
  stopping: null,
  pendingEntry: null,
  ...over,
});

describe("reconciling with the server", () => {
  it("shows a timer that started somewhere else", () => {
    const next = reconcileTimer(sync(), server(), 1_000_000);
    expect(next.timer?.key).toBe(STARTED);
    expect(next.stopping).toBeNull();
  });

  it("drops a timer that was stopped somewhere else", () => {
    const running = timerFromServer(server(), 1_000_000);
    expect(reconcileTimer(sync({ timer: running }), null, 2_000_000)).toEqual(sync());
  });

  it("keeps the instant a clock was started here when the same clock comes back, with the server's newer estimate", () => {
    const running = { ...timerFromServer(server(), 1_000_000), startMs: 123, initialElapsedMs: 7 };
    const next = reconcileTimer(sync({ timer: running }), withEstimate(120, 30), 9_000_000);
    expect(next.timer?.startMs).toBe(123);
    expect(next.timer?.initialElapsedMs).toBe(7);
    expect(next.timer?.estimate?.estimatedMinutes).toBe(120);
  });

  it("ignores a read that still shows the clock being stopped", () => {
    const stopped = timerFromServer(server(), 1_000_000);
    const pressed = sync({
      stopping: stopped.key,
      pendingEntry: { assignmentId: "a1", taskId: "t1", minutes: 13 },
    });
    expect(reconcileTimer(pressed, server(), 2_000_000)).toBe(pressed);
  });

  it("drops the minutes shown as logged once the server no longer has the clock", () => {
    const pressed = sync({
      stopping: STARTED,
      pendingEntry: { assignmentId: "a1", taskId: "t1", minutes: 13 },
    });
    expect(reconcileTimer(pressed, null, 2_000_000)).toEqual(sync());
  });

  it("ignores a read with no clock while a start is on its way", () => {
    const starting = sync({ timer: optimisticTimer("me", target, 1000) });
    expect(reconcileTimer(starting, null, 2000)).toBe(starting);
  });

  it("takes the server's clock in place of an optimistic one that has been answered", () => {
    const starting = sync({ timer: optimisticTimer("me", target, 1000) });
    const next = reconcileTimer(starting, server(), 2_000_000);
    expect(next.timer?.key).toBe(STARTED);
  });

  it("forgets the clock a start switched off once the server shows the new one", () => {
    // Started B while A ran: A is being stopped and logged, its minutes shown as logged.
    const switching = sync({
      timer: optimisticTimer("me", target, 1000),
      stopping: "2026-09-29T09:00:00.000Z",
      pendingEntry: { assignmentId: "a0", taskId: null, minutes: 40 },
    });
    // A read that still shows A is stale.
    const stale = server({ startedAt: "2026-09-29T09:00:00.000Z" });
    expect(reconcileTimer(switching, stale, 2000)).toBe(switching);
    // A read that shows B: A is stopped and in the server's figures.
    const next = reconcileTimer(switching, server(), 2000);
    expect(next).toMatchObject({ stopping: null, pendingEntry: null });
    expect(next.timer?.key).toBe(STARTED);
  });
});

describe("live minutes on an assignment or task", () => {
  const running: ClientTimer = { ...timerFromServer(server(), 1_000_000), startMs: 0 };

  it("counts the whole minutes of a clock running on it", () => {
    expect(liveMinutes(running, null, 12 * MIN + 59_000, { assignmentId: "a1" })).toBe(12);
    expect(liveMinutes(running, null, 12 * MIN + 59_000, { assignmentId: "a1", taskId: "t1" })).toBe(12);
  });

  it("counts nothing for another assignment or another task", () => {
    expect(liveMinutes(running, null, 12 * MIN, { assignmentId: "a2" })).toBe(0);
    expect(liveMinutes(running, null, 12 * MIN, { assignmentId: "a1", taskId: "t2" })).toBe(0);
    expect(liveMinutes(running, null, 12 * MIN, { assignmentId: "a1", taskId: null })).toBe(0);
  });

  it("counts the minutes of a clock just stopped until the server's figures have them", () => {
    const pending = { assignmentId: "a1", taskId: "t1", minutes: 13 };
    expect(liveMinutes(null, pending, 0, { assignmentId: "a1" })).toBe(13);
    expect(liveMinutes(null, pending, 0, { assignmentId: "a1", taskId: "t1" })).toBe(13);
    expect(liveMinutes(null, pending, 0, { assignmentId: "a1", taskId: "t2" })).toBe(0);
    expect(liveMinutes(null, null, 0, { assignmentId: "a1" })).toBe(0);
  });

  it("uses what the server read before the clock ticks", () => {
    const fresh = timerFromServer(server(), 5_000_000);
    expect(liveMinutes(fresh, null, null, { assignmentId: "a1" })).toBe(12);
  });
});

describe("estimate warnings", () => {
  // 60 minutes estimated, 40 logged before this timer: 20 left when it starts. Warn 10 minutes before.
  const timerAt = (elapsedMs: number, over: Partial<RunningTimer> = {}) => {
    const base = timerFromServer(
      { ...withEstimate(60, 40), ...over, serverNow: new Date(Date.parse(STARTED) + elapsedMs).toISOString() },
      elapsedMs,
    );
    return { ...base, startMs: 0 };
  };
  const none = new Set<"near" | "over">();

  it("is quiet while there is more than the threshold left", () => {
    expect(timerAlert(timerAt(9 * MIN), 9 * MIN, none)).toBeNull();
    // Exactly 10 left has not fired: strictly less does.
    expect(timerAlert(timerAt(10 * MIN), 10 * MIN, none)).toBeNull();
  });

  it("warns once when less than the threshold is left, and again when it is used up", () => {
    const near = timerAlert(timerAt(11 * MIN), 11 * MIN, none);
    expect(near).toBe("near");
    expect(timerAlert(timerAt(15 * MIN), 15 * MIN, new Set(["near"]))).toBeNull();
    expect(timerAlert(timerAt(20 * MIN), 20 * MIN, new Set(["near"]))).toBe("over");
    expect(timerAlert(timerAt(25 * MIN), 25 * MIN, new Set(["near", "over"]))).toBeNull();
  });

  it("raises only the last stage when the clock jumps straight past both", () => {
    expect(timerAlert(timerAt(30 * MIN), 30 * MIN, none)).toBe("over");
  });

  it("is off with no estimate, with warnings off, and with neither message nor sound", () => {
    const plain = { ...timerFromServer(server(), 1), startMs: 0 };
    expect(timerAlert(plain, 90 * MIN, none)).toBeNull();
    const off = { ...timerFromServer(withEstimate(60, 40, null), 1), startMs: 0 };
    expect(timerAlert(off, 90 * MIN, none)).toBeNull();
    const quiet = timerAt(30 * MIN);
    quiet.estimate = quiet.estimate && { ...quiet.estimate, settings: { minutes: 10, popup: false, sound: false } };
    expect(timerAlert(quiet, 30 * MIN, none)).toBeNull();
    quiet.estimate = quiet.estimate && { ...quiet.estimate, settings: { minutes: 10, popup: false, sound: true } };
    expect(timerAlert(quiet, 30 * MIN, none)).toBe("over");
  });

  it("is not armed for a clock the server has not answered yet", () => {
    const pending = { ...optimisticTimer("me", target, 0), estimate: timerAt(0).estimate };
    expect(timerAlert(pending, 90 * MIN, none)).toBeNull();
  });

  it("remembers the stages per person and running timer, in a form that reads back", () => {
    expect(alertKey({ accountId: "me", key: STARTED })).toBe(`work-estimate-alert:me:${STARTED}`);
    expect(alertKey({ accountId: "you", key: STARTED })).not.toBe(alertKey({ accountId: "me", key: STARTED }));
    expect(serialiseFired(new Set(["over", "near"]))).toBe("near,over");
    expect(parseFired("near,over")).toEqual(new Set(["near", "over"]));
    // A single stage as Life kept it, and anything unreadable.
    expect(parseFired("near")).toEqual(new Set(["near"]));
    expect(parseFired("garbage,,over")).toEqual(new Set(["over"]));
    expect(parseFired(null)).toEqual(new Set());
  });

  it("chimes two rising notes for nearly there and three for used up", () => {
    expect(chimeFrequencies("near")).toHaveLength(2);
    expect(chimeFrequencies("over")).toHaveLength(3);
    for (const stage of ["near", "over"] as const) {
      const notes = chimeFrequencies(stage);
      expect([...notes].sort((a, b) => a - b)).toEqual(notes);
    }
  });

  it("says what the popup is about", () => {
    const timer = timerAt(0);
    expect(alertMessage("near", timer)).toEqual({
      title: "Nearly at the estimate",
      body: "The estimate for Design (1h) is nearly used up.",
    });
    const over = alertMessage("over", { ...timer, taskTitle: null });
    expect(over.title).toBe("Estimate used up");
    expect(over.body).toContain("Website");
  });
});
