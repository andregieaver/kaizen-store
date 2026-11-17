import { describe, expect, it } from "vitest";

import { allowanceSeconds, cronHealth, cronHeartbeat, jobsCheck, jobsNeedingLook, stoppedJobs, type CronJobRow } from "./cron-health";

const now = new Date("2026-10-24T12:00:00Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();
const row = (over: Partial<CronJobRow>): CronJobRow => ({
  job: "carts",
  everySeconds: 300,
  lastFinishedAt: ago(60),
  lastOkAt: ago(60),
  lastError: null,
  failures: 0,
  ...over,
});

describe("cron job health", () => {
  it("allows a job every minute eleven minutes, a five-minute job fifteen and a daily one thirty hours", () => {
    expect(allowanceSeconds(60)).toBe(660);
    expect(allowanceSeconds(300)).toBe(900);
    expect(allowanceSeconds(86_400)).toBe(86_400 + 21_600);
  });

  it("is late past its allowance, and fine within it", () => {
    expect(cronHealth(row({ lastFinishedAt: ago(899) }), now)).toBe("ok");
    expect(cronHealth(row({ lastFinishedAt: ago(901) }), now)).toBe("late");
    expect(cronHealth(row({ lastFinishedAt: null }), now)).toBe("late");
  });

  it("is failing after three failed runs in a row, however recent", () => {
    expect(cronHealth(row({ failures: 2, lastError: "boom" }), now)).toBe("ok");
    expect(cronHealth(row({ failures: 3, lastError: "boom" }), now)).toBe("failing");
  });

  it("lists failing jobs first, then the longest late, and leaves the fine ones out", () => {
    const list = jobsNeedingLook(
      [
        row({ job: "fine" }),
        row({ job: "late-a", lastFinishedAt: ago(1_000) }),
        row({ job: "late-b", lastFinishedAt: ago(5_000) }),
        row({ job: "broken", failures: 4 }),
      ],
      now,
    );
    expect(list.map((r) => [r.job, r.health])).toEqual([
      ["broken", "failing"],
      ["late-b", "late"],
      ["late-a", "late"],
    ]);
  });
});

describe("the outside heartbeat (F3, D672)", () => {
  it("beats while every scheduled route keeps running, whatever a dispatcher job does, and not with no route at all", () => {
    const routes = [row({ job: "route.cart-reminders", everySeconds: 300 }), row({ job: "route.autopilot", everySeconds: 60 })];
    expect(cronHeartbeat(routes, now)).toEqual({ ok: true, routes: 2, lateRoutes: 0, lateJobs: 0, failingJobs: 0 });
    // A dispatcher job late and another failing: counted, still alive.
    const jobs = [...routes, row({ job: "dispatcher.carts", lastFinishedAt: ago(3600) }), row({ job: "dispatcher.plans", failures: 3 })];
    expect(cronHeartbeat(jobs, now)).toMatchObject({ ok: true, lateJobs: 1, failingJobs: 1 });
    // The dispatcher's route quiet for twenty minutes: the scheduler is down.
    expect(cronHeartbeat([row({ job: "route.cart-reminders", everySeconds: 300, lastFinishedAt: ago(1200) }), routes[1]], now)).toMatchObject({ ok: false, lateRoutes: 1 });
    expect(cronHeartbeat([], now)).toMatchObject({ ok: false, routes: 0 });
  });
});

describe("the watcher and the status page's jobs check (step 1.22)", () => {
  it("finds the dispatcher's route stopped after fifteen minutes, or when it has no row", () => {
    const fresh = [row({ job: "route.cart-reminders", everySeconds: 300, lastFinishedAt: ago(5 * 60) })];
    expect(stoppedJobs(fresh, now)).toEqual([]);
    const late = [row({ job: "route.cart-reminders", everySeconds: 300, lastFinishedAt: ago(16 * 60 + 10) })];
    expect(stoppedJobs(late, now)).toEqual([{ job: "route.cart-reminders", minutes: 16 }]);
    expect(stoppedJobs([], now)).toEqual([{ job: "route.cart-reminders", minutes: null }]);
    expect(stoppedJobs([row({ job: "route.cart-reminders", lastFinishedAt: null })], now)).toEqual([{ job: "route.cart-reminders", minutes: null }]);
  });

  it("fails the jobs check on a late watcher or a late daily job, not on a late one-minute route, and on a failing job", () => {
    expect(jobsCheck([row({ job: "route.watchdog", everySeconds: 900, lastFinishedAt: ago(60) })], now)).toEqual({ ok: true, reason: null });
    expect(jobsCheck([row({ job: "route.watchdog", everySeconds: 900, lastFinishedAt: ago(50 * 60) })], now)).toEqual({ ok: false, reason: "late" });
    expect(jobsCheck([row({ job: "daily.heat", everySeconds: 86_400, lastFinishedAt: ago(31 * 3600) })], now)).toEqual({ ok: false, reason: "late" });
    expect(jobsCheck([row({ job: "dispatcher.carts", everySeconds: 300, lastFinishedAt: ago(3600) })], now)).toEqual({ ok: false, reason: "late" });
    expect(jobsCheck([row({ job: "route.page-looks", everySeconds: 60, lastFinishedAt: ago(3600) })], now)).toEqual({ ok: true, reason: null });
    expect(jobsCheck([row({ job: "route.page-looks", failures: 3 })], now)).toEqual({ ok: false, reason: "failing" });
  });
});
