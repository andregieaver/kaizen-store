import { describe, expect, it } from "vitest";

import { minutesToHundredths } from "./work-calc";
import {
  MAX_ENTRY_MINUTES,
  NO_TASK_FILTER,
  billableMinutes,
  elapsedSeconds,
  filterTimeEntries,
  formatClockMinutes,
  formatDuration,
  formatTimerClock,
  invoiceableMinutes,
  isValidEntryMinutes,
  parseDuration,
  timerMinutes,
  timerWorkDate,
  totalMinutes,
} from "./work-time";

const minutes = (text: string, options?: Parameters<typeof parseDuration>[1]) => {
  const r = parseDuration(text, options);
  return r.ok ? r.minutes : r.reason;
};

describe("reading a duration", () => {
  it("reads hours and minutes in the forms people type", () => {
    const cases: [string, number][] = [
      ["1h30", 90],
      ["1h 30m", 90],
      ["1h30m", 90],
      ["  1H30M ", 90],
      ["1h05", 65],
      ["2h", 120],
      ["1 t 30 min", 90],
      ["1t30", 90],
      ["2 timer", 120],
      ["1 time", 60],
      ["1 tim 30 minuter", 90],
      ["2 timmar", 120],
      ["1 hour 15 minutes", 75],
      ["1:30", 90],
      ["0:45", 45],
      ["10:00", 600],
      ["90m", 90],
      ["90 min", 90],
      ["90 minutes", 90],
      ["15 minutter", 15],
      ["90", 90],
      ["1", 1],
    ];
    for (const [text, want] of cases) expect(minutes(text), text).toBe(want);
  });

  it("reads decimal hours with a comma or a dot, rounded half up to the minute", () => {
    expect(minutes("1.5h")).toBe(90);
    expect(minutes("1,5 t")).toBe(90);
    expect(minutes("1.25h")).toBe(75);
    expect(minutes("0.33h")).toBe(20); // 19.8 minutes
    expect(minutes("0.5h")).toBe(30);
    expect(minutes(".5h")).toBe(30);
    expect(minutes("0.0083h")).toBe("zero"); // 0.498 minutes rounds to nothing
    expect(minutes("0.0084h")).toBe(1); // 0.504 minutes
  });

  it("treats a bare number as minutes, or as hours where the field is an estimate", () => {
    expect(minutes("90")).toBe(90);
    expect(minutes("1,5", { bare: "hours" })).toBe(90);
    expect(minutes("2", { bare: "hours" })).toBe(120);
    expect(minutes("1.5")).toBe("unrecognised"); // a fraction of a minute makes no sense
    expect(minutes("90m", { bare: "hours" })).toBe(90);
  });

  it("refuses what it cannot read", () => {
    expect(minutes("")).toBe("empty");
    expect(minutes("   ")).toBe("empty");
    for (const bad of ["abc", "1:75", "1:5", "1.5h30", "-5", "1h-30", "h", "1h30x", "1:30:00", "1 2 3", "0x10"]) {
      expect(minutes(bad), bad).toBe("unrecognised");
    }
  });

  it("refuses zero and more than a day (or the given limit)", () => {
    expect(minutes("0")).toBe("zero");
    expect(minutes("0m")).toBe("zero");
    expect(minutes("0:00")).toBe("zero");
    expect(minutes("0h")).toBe("zero");
    expect(minutes("24h")).toBe(MAX_ENTRY_MINUTES);
    expect(minutes("25h")).toBe("too_long");
    expect(minutes("1441")).toBe("too_long");
    expect(minutes("100h", { max: 6000 })).toBe(6000);
    expect(minutes("101h", { max: 6000 })).toBe("too_long");
  });

  it("gives back what formatting wrote", () => {
    for (const m of [1, 45, 60, 61, 90, 600, 1440]) {
      expect(minutes(formatClockMinutes(m)), `${m}`).toBe(m);
      expect(minutes(formatDuration(m)), `${m}`).toBe(m);
    }
  });
});

describe("showing time", () => {
  it("writes minutes for people", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatClockMinutes(90)).toBe("1:30");
    expect(formatClockMinutes(5)).toBe("0:05");
    expect(() => formatDuration(-1)).toThrow(RangeError);
    expect(() => formatDuration(1.5)).toThrow(RangeError);
  });

  it("writes a running clock", () => {
    expect(formatTimerClock(0)).toBe("0:00:00");
    expect(formatTimerClock(3725)).toBe("1:02:05");
    expect(formatTimerClock(-5)).toBe("0:00:00");
    expect(formatTimerClock(90_061)).toBe("25:01:01");
  });

  it("checks an entry's minutes", () => {
    expect(isValidEntryMinutes(1)).toBe(true);
    expect(isValidEntryMinutes(1440)).toBe(true);
    expect(isValidEntryMinutes(0)).toBe(false);
    expect(isValidEntryMinutes(1441)).toBe(false);
    expect(isValidEntryMinutes(1.5)).toBe(false);
  });
});

describe("timers", () => {
  const t0 = Date.parse("2026-09-28T10:00:00Z");

  it("counts every started minute and never less than one (max(1, ceil(elapsed / 60 s)))", () => {
    expect(timerMinutes(t0, t0 + 60_000).minutes).toBe(1);
    expect(timerMinutes(t0, t0 + 60_001).minutes).toBe(2);
    expect(timerMinutes(t0, t0).minutes).toBe(1);
    expect(timerMinutes(t0, t0 + 1).minutes).toBe(1);
    expect(timerMinutes(t0, t0 + 59_999).minutes).toBe(1);
    expect(timerMinutes(t0, t0 + 90 * 60_000).minutes).toBe(90);
    expect(timerMinutes(new Date(t0), new Date(t0 + 125_000))).toEqual({
      minutes: 3,
      elapsedMinutes: 3,
      capped: false,
    });
  });

  it("does not go negative when two devices' clocks disagree", () => {
    expect(timerMinutes(t0, t0 - 5_000).minutes).toBe(1);
    expect(elapsedSeconds(t0, t0 - 5_000)).toBe(0);
  });

  it("caps at a day and says so, instead of losing the time or breaking the entry limit", () => {
    const r = timerMinutes(t0, t0 + 25 * 3_600_000);
    expect(r).toEqual({ minutes: 1440, elapsedMinutes: 1500, capped: true });
    expect(isValidEntryMinutes(r.minutes)).toBe(true);
    expect(timerMinutes(t0, t0 + 24 * 3_600_000).capped).toBe(false);
  });

  it("counts elapsed whole seconds", () => {
    expect(elapsedSeconds(t0, t0 + 61_999)).toBe(61);
  });

  it("dates the entry the day the timer started where the store is, not the UTC day", () => {
    const started = "2026-09-28T22:30:00Z"; // 00:30 on the 29th in Oslo
    expect(timerWorkDate(Date.parse(started), "Europe/Oslo")).toBe("2026-09-29");
    expect(timerWorkDate(new Date(started), "UTC")).toBe("2026-09-28");
  });
});

describe("totals over entries", () => {
  const entries = [
    { minutes: 90, billable: true, prepaidMinutes: 60 },
    { minutes: 30, billable: false },
    { minutes: 15, billable: true, invoiceLineId: "line-1" },
  ];

  it("counts all, billable, and what an invoice would take", () => {
    expect(totalMinutes(entries)).toBe(135);
    expect(billableMinutes(entries)).toBe(105);
    expect(invoiceableMinutes(entries)).toBe(30 + 15); // less the prepaid 60
    expect(invoiceableMinutes(entries, { onlyUnbilled: true })).toBe(30); // the 15 is on a line already
  });

  it("never lets prepaid hours make a negative", () => {
    expect(invoiceableMinutes([{ minutes: 10, billable: true, prepaidMinutes: 30 }])).toBe(0);
    expect(invoiceableMinutes([])).toBe(0);
  });

  it("turns Life's smoke case into a line's hours: 90 + 15 billable, 30 not, is 1.75 h", () => {
    const smoke = [
      { minutes: 90, billable: true },
      { minutes: 30, billable: false },
      { minutes: 15, billable: true },
    ];
    expect(minutesToHundredths(billableMinutes(smoke))).toBe(175);
  });
});

describe("finding entries again (Life's smoke case)", () => {
  const entries = [
    { id: "a", taskId: "t1", taskTitle: "Design review", note: "Header rework" },
    { id: "b", taskId: "t2", taskTitle: "Weekly meeting", note: null },
    { id: "c", taskId: null, taskTitle: null, note: "Invoice-level admin" },
  ];
  const ids = (list: { id: string }[]) => list.map((e) => e.id).join(",");

  it("shows everything with no filter and a blank search", () => {
    expect(ids(filterTimeEntries(entries, { taskId: null, query: "" }))).toBe("a,b,c");
    expect(ids(filterTimeEntries(entries, { taskId: null, query: "   " }))).toBe("a,b,c");
  });

  it("filters by task exactly, or to the entries with no task", () => {
    expect(ids(filterTimeEntries(entries, { taskId: "t2", query: "" }))).toBe("b");
    expect(ids(filterTimeEntries(entries, { taskId: NO_TASK_FILTER, query: "" }))).toBe("c");
  });

  it("searches the comment and the task's title, ignoring case", () => {
    expect(ids(filterTimeEntries(entries, { taskId: null, query: "HEADER" }))).toBe("a");
    expect(ids(filterTimeEntries(entries, { taskId: null, query: "meeting" }))).toBe("b");
  });

  it("applies the filter and the search together", () => {
    expect(ids(filterTimeEntries(entries, { taskId: "t1", query: "meeting" }))).toBe("");
    expect(ids(filterTimeEntries(entries, { taskId: NO_TASK_FILTER, query: "admin" }))).toBe("c");
  });
});
