import { describe, expect, it } from "vitest";

import { candidatePeriods, exportKey, returnsDue, schemesOf, type DueProfile } from "./tax-returns-due";

const profile = (over: Partial<DueProfile> = {}): DueProfile => ({ ossScheme: "union", ossRegisteredOn: null, iossNumber: null, iossIntermediary: null, iossRegisteredOn: null, ...over });
const none = new Set<string>();

describe("which registrations the owner takes data for", () => {
  it("is an OSS scheme, or an IOSS number without an intermediary (the intermediary files that one)", () => {
    expect(schemesOf(profile())).toEqual(["oss"]);
    expect(schemesOf(profile({ ossScheme: "non_union" }))).toEqual(["oss"]);
    expect(schemesOf(profile({ ossScheme: "none" }))).toEqual([]);
    expect(schemesOf(profile({ ossScheme: "none", iossNumber: "IM2460000000" }))).toEqual(["ioss"]);
    expect(schemesOf(profile({ ossScheme: "none", iossNumber: "IM2460000000", iossIntermediary: "IN1234567890" }))).toEqual([]);
    expect(schemesOf(profile({ iossNumber: "IM2460000000" }))).toEqual(["oss", "ioss"]);
  });
});

describe("the periods looked at", () => {
  it("are the latest two that have ended, newest first", () => {
    expect(candidatePeriods("oss", "2026-10-04").map((p) => p.key)).toEqual(["2026-Q3", "2026-Q2"]);
    expect(candidatePeriods("ioss", "2026-10-04").map((p) => p.key)).toEqual(["2026-09", "2026-08"]);
    expect(candidatePeriods("oss", "2027-01-02").map((p) => p.key)).toEqual(["2026-Q4", "2026-Q3"]);
  });
});

describe("returns due", () => {
  it("says nothing early in the month after the period: the deadline is more than 14 days away", () => {
    expect(returnsDue(profile(), none, "2026-10-04")).toEqual([]);
  });

  it("names a quarter whose deadline is within 14 days, in the words of the spec, without saying anything is late", () => {
    const [due, ...rest] = returnsDue(profile(), none, "2026-10-20");
    expect(rest.map((d) => d.period.key)).toEqual([]);
    expect(due.text).toBe("Your OSS data for Q3 2026 has not been exported; it is due 31 October.");
    expect(due.state).toBe("due_soon");
    expect(due.path).toBe("/analytics/tax?view=oss&quarter=2026-Q3");
    expect(due.text).not.toMatch(/late|overdue/i);
  });

  it("after the deadline still says only that the day has passed, for 45 days, and then goes quiet", () => {
    const due = returnsDue(profile(), none, "2026-11-03");
    expect(due.map((d) => d.period.key)).toEqual(["2026-Q3"]);
    expect(due[0].text).toBe("Your OSS data for Q3 2026 has not been exported; the due date, 31 October, has passed.");
    expect(due[0].state).toBe("passed");
    expect(returnsDue(profile(), none, "2026-12-16")).toEqual([]);
    expect(returnsDue(profile(), none, "2026-12-15").map((d) => d.period.key)).toEqual(["2026-Q3"]);
  });

  it("is quiet for a period whose Return data was exported in filing mode", () => {
    expect(returnsDue(profile(), new Set([exportKey("oss", { key: "2026-Q3" }), exportKey("oss", { key: "2026-Q2" })]), "2026-10-20")).toEqual([]);
  });

  it("does not count a period that ended before the registration day", () => {
    const due = returnsDue(profile({ ossRegisteredOn: "2026-10-01" }), none, "2026-11-03");
    expect(due).toEqual([]);
    const during = returnsDue(profile({ ossRegisteredOn: "2026-09-15" }), none, "2026-11-03");
    expect(during.map((d) => d.period.key)).toEqual(["2026-Q3"]);
  });

  it("counts only periods that had something to report, when the server says which", () => {
    expect(returnsDue(profile(), none, "2026-10-20", new Set())).toEqual([]);
    expect(returnsDue(profile(), none, "2026-10-20", new Set(["oss:2026-Q3"])).map((d) => d.period.key)).toEqual(["2026-Q3"]);
  });

  it("names the month of an IOSS return, due the end of the next month, and nothing when an intermediary files", () => {
    const due = returnsDue(profile({ ossScheme: "none", iossNumber: "IM2460000000" }), none, "2026-10-20");
    expect(due.map((d) => d.text)).toEqual([
      "Your IOSS data for September 2026 has not been exported; it is due 31 October.",
      "Your IOSS data for August 2026 has not been exported; the due date, 30 September, has passed.",
    ]);
    expect(due[0].path).toBe("/analytics/tax?view=ioss&month=2026-09");
    expect(returnsDue(profile({ ossScheme: "none", iossNumber: "IM2460000000", iossIntermediary: "IN1" }), none, "2026-10-20")).toEqual([]);
  });

  it("says nothing for a store with no registration", () => {
    expect(returnsDue(profile({ ossScheme: "none" }), none, "2026-10-20")).toEqual([]);
  });
});
