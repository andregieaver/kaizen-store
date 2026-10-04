import { describe, expect, it } from "vitest";

import {
  deadlineOf,
  deadlineSentence,
  deadlineState,
  isOpenPeriod,
  lastCompletedMonth,
  lastCompletedQuarter,
  longDate,
  monthOfDay,
  monthPeriod,
  parseMonthKey,
  parseQuarterKey,
  periodLabel,
  quarterOfDay,
  quarterPeriod,
  rangeKey,
  shiftPeriod,
} from "./tax-periods";

describe("quarters and months", () => {
  it("are half open, with their last day", () => {
    expect(quarterPeriod(2026, 3)).toMatchObject({ kind: "quarter", key: "2026-Q3", from: "2026-07-01", to: "2026-10-01", lastDay: "2026-09-30" });
    expect(quarterPeriod(2026, 4)).toMatchObject({ from: "2026-10-01", to: "2027-01-01", lastDay: "2026-12-31" });
    expect(quarterPeriod(2026, 1)).toMatchObject({ from: "2026-01-01", to: "2026-04-01", lastDay: "2026-03-31" });
    expect(monthPeriod(2026, 9)).toMatchObject({ kind: "month", key: "2026-09", from: "2026-09-01", to: "2026-10-01", lastDay: "2026-09-30" });
    expect(monthPeriod(2028, 2).lastDay).toBe("2028-02-29");
    expect(monthPeriod(2026, 2).lastDay).toBe("2026-02-28");
    expect(monthPeriod(2026, 12)).toMatchObject({ to: "2027-01-01", lastDay: "2026-12-31" });
  });

  it("refuse what is not a period", () => {
    expect(() => quarterPeriod(2026, 5)).toThrow(RangeError);
    expect(() => quarterPeriod(2026, 0)).toThrow(RangeError);
    expect(() => monthPeriod(2026, 13)).toThrow(RangeError);
    expect(() => monthPeriod(1999, 1)).toThrow(RangeError);
    expect(() => quarterOfDay("2026-13-01")).toThrow(RangeError);
  });

  it("are read from their keys", () => {
    expect(parseQuarterKey("2026-Q3")?.from).toBe("2026-07-01");
    expect(parseQuarterKey("2026-q2")?.key).toBe("2026-Q2");
    expect(parseQuarterKey("2026-Q5")).toBeNull();
    expect(parseQuarterKey("2026-09")).toBeNull();
    expect(parseQuarterKey(undefined)).toBeNull();
    expect(parseMonthKey("2026-09")?.lastDay).toBe("2026-09-30");
    expect(parseMonthKey("2026-00")).toBeNull();
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("2026-Q3")).toBeNull();
    expect(parseMonthKey(42)).toBeNull();
  });

  it("are found from a day, including the first and last days", () => {
    expect(quarterOfDay("2026-09-30").key).toBe("2026-Q3");
    expect(quarterOfDay("2026-10-01").key).toBe("2026-Q4");
    expect(quarterOfDay("2026-01-01").key).toBe("2026-Q1");
    expect(quarterOfDay("2026-06-30").key).toBe("2026-Q2");
    expect(monthOfDay("2026-12-31").key).toBe("2026-12");
    expect(monthOfDay("2027-01-01").key).toBe("2027-01");
  });

  it("move across a year", () => {
    expect(shiftPeriod(quarterPeriod(2026, 1), -1).key).toBe("2025-Q4");
    expect(shiftPeriod(quarterPeriod(2026, 4), 1).key).toBe("2027-Q1");
    expect(shiftPeriod(monthPeriod(2026, 1), -1).key).toBe("2025-12");
    expect(shiftPeriod(monthPeriod(2026, 12), 2).key).toBe("2027-02");
  });

  it("have a last completed one that is never the open one", () => {
    expect(lastCompletedQuarter("2026-10-04").key).toBe("2026-Q3");
    expect(lastCompletedQuarter("2026-09-30").key).toBe("2026-Q2");
    expect(lastCompletedQuarter("2027-01-01").key).toBe("2026-Q4");
    expect(lastCompletedMonth("2026-10-04").key).toBe("2026-09");
    expect(lastCompletedMonth("2026-01-15").key).toBe("2025-12");
  });
});

describe("deadlines (Commission OSS guidelines, Part 2)", () => {
  it("are the end of the month after the quarter: 30 April, 31 July, 31 October, 31 January", () => {
    expect(deadlineOf(quarterPeriod(2026, 1))).toBe("2026-04-30");
    expect(deadlineOf(quarterPeriod(2026, 2))).toBe("2026-07-31");
    expect(deadlineOf(quarterPeriod(2026, 3))).toBe("2026-10-31");
    expect(deadlineOf(quarterPeriod(2026, 4))).toBe("2027-01-31");
  });

  it("are the end of the next month for an IOSS month, in a short February too", () => {
    expect(deadlineOf(monthPeriod(2026, 9))).toBe("2026-10-31");
    expect(deadlineOf(monthPeriod(2026, 12))).toBe("2027-01-31");
    expect(deadlineOf(monthPeriod(2026, 1))).toBe("2026-02-28");
    expect(deadlineOf(monthPeriod(2027, 1))).toBe("2027-02-28");
    expect(deadlineOf(monthPeriod(2027, 2))).toBe("2027-03-31");
    expect(deadlineOf(monthPeriod(2028, 1))).toBe("2028-02-29");
  });

  it("does not move for a weekend (31 October 2026 is a Saturday)", () => {
    expect(new Date("2026-10-31T00:00:00Z").getUTCDay()).toBe(6);
    expect(deadlineOf(quarterPeriod(2026, 3))).toBe("2026-10-31");
  });

  it("says where a period stands", () => {
    const q3 = quarterPeriod(2026, 3);
    expect(isOpenPeriod(q3, "2026-09-30")).toBe(true);
    expect(isOpenPeriod(q3, "2026-10-01")).toBe(false);
    expect(deadlineState(q3, "2026-09-15")).toBe("in_progress");
    expect(deadlineState(q3, "2026-10-04")).toBe("upcoming");
    expect(deadlineState(q3, "2026-10-17")).toBe("due_soon");
    expect(deadlineState(q3, "2026-10-31")).toBe("due_soon");
    expect(deadlineState(q3, "2026-11-01")).toBe("passed");
    expect(deadlineState(q3, "2026-10-16")).toBe("upcoming");
  });

  it("is said in words, and never claims a return was or was not filed", () => {
    const q3 = quarterPeriod(2026, 3);
    expect(deadlineSentence(q3, "2026-10-04")).toBe("Q3 2026: submit and pay by 31 October 2026.");
    expect(deadlineSentence(q3, "2026-09-01")).toContain("still in progress");
    expect(deadlineSentence(q3, "2026-11-05")).toContain("Kaizen does not know what was filed");
    expect(periodLabel(monthPeriod(2026, 9))).toBe("September 2026");
    expect(longDate("2027-01-05")).toBe("5 January 2027");
  });

  it("gives a range key with an inclusive end", () => {
    expect(rangeKey("2026-09-01", "2026-10-01")).toBe("2026-09-01..2026-09-30");
  });
});
