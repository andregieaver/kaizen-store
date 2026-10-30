import { describe, expect, it } from "vitest";

import { alertDue, currentState, eventsProblem, dayBars, dayState, lastDays, overallState, sloOf, uptimeBasisPoints, uptimeText } from "./status";

describe("the status page's rules (D360)", () => {
  it("reads a day from its checks, a day with none as missing", () => {
    expect(dayState({ ok: 0, total: 0 })).toBe("none");
    expect(dayState({ ok: 288, total: 288 })).toBe("ok");
    expect(dayState({ ok: 287, total: 288 })).toBe("partial");
    expect(dayState({ ok: 100, total: 288 })).toBe("down");
  });

  it("draws 90 days up to today, oldest first, filling days with no checks", () => {
    const today = new Date("2026-10-28T13:00:00Z");
    const days = lastDays(today);
    expect(days).toHaveLength(90);
    expect(days.at(-1)).toBe("2026-10-28");
    expect(days[0]).toBe("2026-07-31");
    const bars = dayBars([{ day: "2026-10-27", ok: 10, total: 12 }], today);
    expect(bars.at(-2)).toEqual({ day: "2026-10-27", ok: 10, total: 12, state: "partial" });
    expect(bars.at(-1)?.state).toBe("none");
  });

  it("counts uptime over the checks that ran, never rounded up to 100 while one failed", () => {
    expect(uptimeBasisPoints([{ day: "a", ok: 0, total: 0 }])).toBeNull();
    expect(uptimeBasisPoints([{ day: "a", ok: 9999, total: 10000 }])).toBe(9999);
    expect(uptimeBasisPoints([{ day: "a", ok: 99999, total: 100000 }])).toBe(9999);
    expect(uptimeText(9999, "en")).toBe("99.99 %");
    expect(uptimeText(10000, "nb-NO")).toBe("100,00 %");
  });

  it("emails admins once, at the second failure in a row", () => {
    expect(alertDue([false])).toBe(false);
    expect(alertDue([false, false])).toBe(true);
    expect(alertDue([false, false, true])).toBe(true);
    expect(alertDue([false, false, false])).toBe(false);
    expect(alertDue([true, false, false])).toBe(false);
    expect(alertDue([false, true, false])).toBe(false);
  });

  it("says the page's headline from the components and open incidents", () => {
    expect(currentState(null)).toBe("unknown");
    expect(overallState(["ok", "unknown"], [])).toBe("ok");
    expect(overallState(["ok", "degraded"], [])).toBe("degraded");
    expect(overallState(["ok"], [{ impact: "maintenance" }])).toBe("maintenance");
    expect(overallState(["ok"], [{ impact: "major" }, { impact: "minor" }])).toBe("major");
  });
});

describe("Stripe's events arriving (consolidation 8)", () => {
  it("fails on a paid checkout never heard of, then on events left unprocessed", () => {
    expect(eventsProblem({ unprocessed: 0, unheard: 0 })).toBeNull();
    expect(eventsProblem({ unprocessed: 2, unheard: 0 })).toBe("events_unprocessed");
    expect(eventsProblem({ unprocessed: 2, unheard: 1 })).toBe("events_missing");
  });
});

describe("service level objectives (REL-09)", () => {
  const days = (failedPerDay: number[], total = 288) => failedPerDay.map((failed, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, ok: total - failed, total }));

  it("holds each part to its objective over the last 30 days only", () => {
    // 30 days of 288 checks: 99.9 % allows 8 failed checks (40 minutes).
    const month = days(Array(30).fill(0));
    expect(sloOf("website", month)).toEqual({ targetBps: 9_990, actualBps: 10_000, met: true, minutesLeft: 40 });
    month[29] = { ...month[29], ok: 288 - 8 };
    expect(sloOf("website", month)).toMatchObject({ met: true, minutesLeft: 0 });
    month[29] = { ...month[29], ok: 288 - 9 };
    expect(sloOf("website", month)).toMatchObject({ met: false, minutesLeft: -5 });
    // A bad day older than 30 days no longer counts.
    expect(sloOf("website", [...days([200]), ...days(Array(30).fill(0))])).toMatchObject({ met: true });
  });

  it("allows more for the parts that retry by themselves, and says nothing before a check ran", () => {
    const month = days([...Array(29).fill(0), 40]);
    expect(sloOf("website", month).met).toBe(false);
    expect(sloOf("email", month)).toMatchObject({ targetBps: 9_950, met: true, minutesLeft: 3 * 5 });
    expect(sloOf("jobs", [])).toEqual({ targetBps: 9_950, actualBps: null, met: null, minutesLeft: null });
  });
});
