import { describe, expect, it } from "vitest";

import { alertDue, currentState, dayBars, dayState, lastDays, overallState, uptimeBasisPoints, uptimeText } from "./status";

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
