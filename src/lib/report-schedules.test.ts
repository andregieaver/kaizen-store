import { describe, expect, it } from "vitest";

import { readScheduleInput, scheduleDue } from "./report-schedules";

const id = "11111111-1111-4111-8111-111111111111";
const person = "22222222-2222-4222-8222-222222222222";

describe("a report's email schedule (D395)", () => {
  it("reads the form, refusing what is not a schedule", () => {
    expect(readScheduleInput({ reportId: id, frequency: "weekly", weekday: "3", hour: "7", recipients: [person, person] })).toEqual({
      ok: true,
      input: { reportId: id, frequency: "weekly", weekday: 3, monthDay: null, hour: 7, recipients: [person], enabled: true },
    });
    expect(readScheduleInput({ reportId: id, frequency: "monthly", monthDay: "29", hour: "7", recipients: [person] })).toEqual({ ok: false, problem: "day" });
    expect(readScheduleInput({ reportId: id, frequency: "daily", hour: "24", recipients: [person] })).toEqual({ ok: false, problem: "hour" });
    expect(readScheduleInput({ reportId: id, frequency: "daily", hour: "7", recipients: [] })).toEqual({ ok: false, problem: "recipients" });
    expect(readScheduleInput({ reportId: "x", frequency: "daily", hour: "7", recipients: [person] })).toEqual({ ok: false, problem: "report" });
    expect(readScheduleInput({ reportId: id, frequency: "hourly", hour: "7", recipients: [person] })).toEqual({ ok: false, problem: "frequency" });
  });

  it("is due on its day, from its hour, once a day", () => {
    const weekly = { frequency: "weekly" as const, weekday: 1, monthDay: null, hour: 7, enabled: true, lastRunOn: null };
    expect(scheduleDue(weekly, { date: "2026-11-02", weekday: 1, hour: 7 })).toBe(true);
    expect(scheduleDue(weekly, { date: "2026-11-02", weekday: 1, hour: 6 })).toBe(false);
    expect(scheduleDue(weekly, { date: "2026-11-03", weekday: 2, hour: 9 })).toBe(false);
    expect(scheduleDue({ ...weekly, lastRunOn: "2026-11-02" }, { date: "2026-11-02", weekday: 1, hour: 9 })).toBe(false);
    expect(scheduleDue({ ...weekly, enabled: false }, { date: "2026-11-02", weekday: 1, hour: 9 })).toBe(false);
    const monthly = { frequency: "monthly" as const, weekday: null, monthDay: 1, hour: 0, enabled: true, lastRunOn: "2026-10-01" };
    expect(scheduleDue(monthly, { date: "2026-11-01", weekday: 7, hour: 0 })).toBe(true);
    expect(scheduleDue(monthly, { date: "2026-11-02", weekday: 1, hour: 0 })).toBe(false);
    expect(scheduleDue({ frequency: "daily", weekday: null, monthDay: null, hour: 8, enabled: true, lastRunOn: "2026-11-01" }, { date: "2026-11-02", weekday: 1, hour: 8 })).toBe(true);
  });
});
