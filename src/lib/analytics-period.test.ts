import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  addYears,
  bucketFor,
  bucketKey,
  customPeriod,
  daysBetween,
  enumerateBuckets,
  isDay,
  isoWeekday,
  lastYearOf,
  parseAnalyticsParams,
  periodHref,
  periodQuery,
  presetPeriod,
  previousPeriodOf,
  rangeLabel,
  startOfWeek,
  todayIn,
  PRESETS,
} from "./analytics-period";

const OSLO = "Europe/Oslo";
// Friday 2 October 2026, noon in Oslo.
const NOW = new Date("2026-10-02T10:00:00Z");
const parse = (q: Record<string, string> = {}, now = NOW, timeZone = OSLO) => parseAnalyticsParams(q, { now, timeZone });

describe("day arithmetic", () => {
  it("validates real calendar days only", () => {
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("2024-02-29")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-1-1")).toBe(false);
    expect(isDay("26-01-01")).toBe(false);
    expect(isDay(undefined)).toBe(false);
    expect(isDay(20260101)).toBe(false);
  });

  it("adds days across month, year and leap-day ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-05-10", 0)).toBe("2026-05-10");
  });

  it("counts days the same over daylight saving changes", () => {
    // Oslo springs forward on 29 March and falls back on 25 October 2026.
    expect(daysBetween("2026-03-27", "2026-04-03")).toBe(7);
    expect(daysBetween("2026-10-23", "2026-10-30")).toBe(7);
    expect(daysBetween("2026-03-01", "2026-03-01")).toBe(0);
    expect(daysBetween("2026-03-05", "2026-03-01")).toBe(-4);
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });

  it("moves months to the last day when the day does not exist", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-01-01", -13)).toBe("2024-12-01");
  });

  it("moves 29 February to 28 February", () => {
    expect(addYears("2024-02-29", -1)).toBe("2023-02-28");
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
    expect(addYears("2026-10-02", -1)).toBe("2025-10-02");
  });

  it("finds ISO weekdays and Mondays", () => {
    expect(isoWeekday("2026-10-02")).toBe(5);
    expect(isoWeekday("2026-10-04")).toBe(7);
    expect(isoWeekday("2026-10-05")).toBe(1);
    expect(startOfWeek("2026-10-02")).toBe("2026-09-28");
    expect(startOfWeek("2026-10-04")).toBe("2026-09-28");
    expect(startOfWeek("2026-09-28")).toBe("2026-09-28");
    expect(startOfWeek("2026-01-01")).toBe("2025-12-29");
  });

  it("rejects days that are not days", () => {
    expect(() => addDays("nope", 1)).toThrow(RangeError);
  });
});

describe("todayIn", () => {
  it("is the day in the store's zone, not in UTC", () => {
    expect(todayIn(new Date("2026-10-02T22:30:00Z"), OSLO)).toBe("2026-10-03");
    expect(todayIn(new Date("2026-10-02T22:30:00Z"), "UTC")).toBe("2026-10-02");
    expect(todayIn(new Date("2026-10-02T03:00:00Z"), "America/Los_Angeles")).toBe("2026-10-01");
  });

  it("follows the zone over the spring change", () => {
    // 28 March 23:30 UTC is 00:30 on the 29th in Oslo (UTC+1, the change comes at 02:00 local).
    expect(todayIn(new Date("2026-03-28T23:30:00Z"), OSLO)).toBe("2026-03-29");
    // 29 March 00:30 UTC is already 02:30 summer time.
    expect(todayIn(new Date("2026-03-29T00:30:00Z"), OSLO)).toBe("2026-03-29");
    expect(todayIn(new Date("2026-03-29T21:59:00Z"), OSLO)).toBe("2026-03-29");
    expect(todayIn(new Date("2026-03-29T22:00:00Z"), OSLO)).toBe("2026-03-30");
  });

  it("follows the zone over the autumn change", () => {
    // 24 October 22:00 UTC is midnight on the 25th in summer time (UTC+2).
    expect(todayIn(new Date("2026-10-24T21:59:00Z"), OSLO)).toBe("2026-10-24");
    expect(todayIn(new Date("2026-10-24T22:00:00Z"), OSLO)).toBe("2026-10-25");
    // The 25th has 25 hours: the next midnight is 23:00 UTC.
    expect(todayIn(new Date("2026-10-25T22:59:00Z"), OSLO)).toBe("2026-10-25");
    expect(todayIn(new Date("2026-10-25T23:00:00Z"), OSLO)).toBe("2026-10-26");
  });

  it("rejects a zone that does not exist", () => {
    expect(() => todayIn(NOW, "Nowhere/Land")).toThrow(RangeError);
  });
});

describe("presets", () => {
  const today = "2026-10-02";
  it("builds each preset as [from, to)", () => {
    const at = (p: Parameters<typeof presetPeriod>[0]) => {
      const x = presetPeriod(p, today);
      return [x.from, x.to, x.days];
    };
    expect(at("today")).toEqual(["2026-10-02", "2026-10-03", 1]);
    expect(at("yesterday")).toEqual(["2026-10-01", "2026-10-02", 1]);
    expect(at("7d")).toEqual(["2026-09-26", "2026-10-03", 7]);
    expect(at("30d")).toEqual(["2026-09-03", "2026-10-03", 30]);
    expect(at("month")).toEqual(["2026-10-01", "2026-10-03", 2]);
    expect(at("last_month")).toEqual(["2026-09-01", "2026-10-01", 30]);
    expect(at("year")).toEqual(["2026-01-01", "2026-10-03", 275]);
  });

  it("handles the first of a month and of a year", () => {
    expect(presetPeriod("month", "2026-03-01")).toMatchObject({ from: "2026-03-01", to: "2026-03-02", days: 1 });
    expect(presetPeriod("last_month", "2026-03-01")).toMatchObject({ from: "2026-02-01", to: "2026-03-01", days: 28 });
    expect(presetPeriod("last_month", "2026-01-15")).toMatchObject({ from: "2025-12-01", to: "2026-01-01", days: 31 });
    expect(presetPeriod("year", "2026-01-01")).toMatchObject({ from: "2026-01-01", to: "2026-01-02", days: 1 });
  });

  it("counts a leap-year February and a period over a daylight saving change by days", () => {
    expect(presetPeriod("last_month", "2024-03-10").days).toBe(29);
    // 30 days ending 5 April 2026 span the change on 29 March and are still 30 days.
    expect(presetPeriod("30d", "2026-04-05")).toMatchObject({ from: "2026-03-07", days: 30 });
  });

  it("has a label for every preset", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["today", "yesterday", "7d", "30d", "month", "last_month", "year", "custom"]);
    expect(presetPeriod("30d", today).label).toBe("Last 30 days");
    expect(presetPeriod("last_month", today).label).toBe("Previous month");
  });
});

describe("parseAnalyticsParams", () => {
  it("defaults to 30 days against the previous period", () => {
    const p = parse();
    expect(p.period).toMatchObject({ preset: "30d", from: "2026-09-03", to: "2026-10-03", days: 30 });
    expect(p.compare.mode).toBe("previous");
    expect(p.compare.previous).toMatchObject({ from: "2026-08-04", to: "2026-09-03", days: 30 });
    expect(p.compare.lastYear).toBeNull();
    expect(p.notice).toBeNull();
  });

  it("uses the store's day, not the server's", () => {
    // 23:30 UTC on 2 October is already the 3rd in Oslo.
    const p = parse({ period: "today" }, new Date("2026-10-02T23:30:00Z"));
    expect(p.period.from).toBe("2026-10-03");
  });

  it("reads each comparison", () => {
    const year = parse({ period: "7d", compare: "year" });
    expect(year.compare.mode).toBe("year");
    expect(year.compare.previous).toBeNull();
    expect(year.compare.lastYear).toMatchObject({ from: "2025-09-26", to: "2025-10-03", days: 7 });
    const none = parse({ compare: "none" });
    expect(none.compare).toEqual({ mode: "none", previous: null, lastYear: null });
    expect(parse({ compare: "bogus" }).compare.mode).toBe("previous");
  });

  it("falls back to the default for unknown presets and takes the first of repeated values", () => {
    expect(parse({ period: "decade" }).period.preset).toBe("30d");
    expect(parseAnalyticsParams({ period: ["7d", "year"] }, { now: NOW, timeZone: OSLO }).period.preset).toBe("7d");
    expect(parseAnalyticsParams(new URLSearchParams("period=yesterday&compare=none"), { now: NOW, timeZone: OSLO })).toMatchObject({
      period: { preset: "yesterday" },
      compare: { mode: "none" },
    });
  });

  it("reads a custom span with an inclusive end", () => {
    const p = parse({ period: "custom", from: "2026-03-01", to: "2026-03-31" });
    expect(p.period).toMatchObject({ preset: "custom", from: "2026-03-01", to: "2026-04-01", days: 31 });
    expect(p.period.label).toBe("1 Mar – 31 Mar 2026");
    expect(p.compare.previous).toMatchObject({ from: "2026-01-29", to: "2026-03-01", days: 31 });
    expect(p.notice).toBeNull();
  });

  it("treats from and to alone as a custom span", () => {
    expect(parse({ from: "2026-09-01", to: "2026-09-01" }).period).toMatchObject({ preset: "custom", days: 1 });
  });

  it("swaps a reversed span", () => {
    const p = parse({ period: "custom", from: "2026-03-31", to: "2026-03-01" });
    expect(p.period).toMatchObject({ from: "2026-03-01", to: "2026-04-01" });
    expect(p.notice).toMatch(/swapped/);
  });

  it("never reaches past today", () => {
    const p = parse({ period: "custom", from: "2026-09-20", to: "2027-01-01" });
    expect(p.period).toMatchObject({ from: "2026-09-20", to: "2026-10-03" });
    expect(p.notice).toMatch(/past today/);
    const future = parse({ period: "custom", from: "2027-01-01", to: "2027-02-01" });
    expect(future.period).toMatchObject({ from: "2026-10-02", to: "2026-10-03", days: 1 });
  });

  it("cuts a span to 800 days, keeping the latest", () => {
    const p = parse({ period: "custom", from: "2020-01-01", to: "2026-10-02" });
    expect(p.period.days).toBe(800);
    expect(p.period.to).toBe("2026-10-03");
    expect(p.notice).toMatch(/800/);
    expect(parse({ period: "custom", from: "2024-07-24", to: "2026-10-02" }).period.days).toBe(800);
    expect(parse({ period: "custom", from: "2024-07-24", to: "2026-10-02" }).notice).toMatch(/800/);
    expect(parse({ period: "custom", from: "2024-07-25", to: "2026-10-02" }).period.days).toBe(800);
    expect(parse({ period: "custom", from: "2024-07-25", to: "2026-10-02" }).notice).toBeNull();
  });

  it("falls back when a custom span is missing or not a day", () => {
    expect(parse({ period: "custom" }).period.preset).toBe("30d");
    expect(parse({ period: "custom", from: "2026-03-01" }).period.preset).toBe("30d");
    expect(parse({ period: "custom", from: "2026-02-30", to: "2026-03-01" }).period.preset).toBe("30d");
    expect(parse({ period: "custom", from: "x", to: "y" }).period.preset).toBe("30d");
  });

  it("ignores from and to when a preset is named", () => {
    expect(parse({ period: "7d", from: "2026-01-01", to: "2026-01-31" }).period.preset).toBe("7d");
  });
});

describe("previous period", () => {
  it("is the same length straight before", () => {
    expect(previousPeriodOf(presetPeriod("7d", "2026-10-02"))).toMatchObject({ from: "2026-09-19", to: "2026-09-26", days: 7 });
    expect(previousPeriodOf(presetPeriod("today", "2026-10-02"))).toMatchObject({ from: "2026-10-01", to: "2026-10-02", days: 1 });
    expect(previousPeriodOf(presetPeriod("yesterday", "2026-10-02"))).toMatchObject({ from: "2026-09-30", to: "2026-10-01" });
    expect(previousPeriodOf(customPeriod("2026-03-01", "2026-03-10"))).toMatchObject({ from: "2026-02-19", to: "2026-03-01", days: 10 });
  });

  it("holds this month's elapsed days against the same days of the month before", () => {
    expect(previousPeriodOf(presetPeriod("month", "2026-10-02"))).toMatchObject({ from: "2026-09-01", to: "2026-09-03", days: 2 });
    expect(previousPeriodOf(presetPeriod("month", "2026-10-31"))).toMatchObject({ from: "2026-09-01", to: "2026-10-01", days: 30 });
  });

  it("cuts the elapsed days at the end of a shorter month", () => {
    const march31 = previousPeriodOf(presetPeriod("month", "2026-03-31"));
    expect(march31).toMatchObject({ from: "2026-02-01", to: "2026-03-01", days: 28 });
    expect(previousPeriodOf(presetPeriod("month", "2026-03-29"))).toMatchObject({ from: "2026-02-01", to: "2026-03-01", days: 28 });
    expect(previousPeriodOf(presetPeriod("month", "2026-03-28"))).toMatchObject({ days: 28 });
    expect(previousPeriodOf(presetPeriod("month", "2026-03-27"))).toMatchObject({ to: "2026-02-28", days: 27 });
    // January against December, over the year's end.
    expect(previousPeriodOf(presetPeriod("month", "2026-01-10"))).toMatchObject({ from: "2025-12-01", to: "2025-12-11" });
  });

  it("sets the previous month against the month before it", () => {
    expect(previousPeriodOf(presetPeriod("last_month", "2026-10-02"))).toMatchObject({ from: "2026-08-01", to: "2026-09-01", days: 31 });
    expect(previousPeriodOf(presetPeriod("last_month", "2026-03-15"))).toMatchObject({ from: "2026-01-01", to: "2026-02-01", days: 31 });
    expect(previousPeriodOf(presetPeriod("last_month", "2026-01-15"))).toMatchObject({ from: "2025-11-01", to: "2025-12-01", days: 30 });
  });

  it("sets the year to date against the same days of last year", () => {
    expect(previousPeriodOf(presetPeriod("year", "2026-10-02"))).toMatchObject({ from: "2025-01-01", to: "2025-10-03", days: 275 });
    expect(previousPeriodOf(presetPeriod("year", "2026-01-01"))).toMatchObject({ from: "2025-01-01", to: "2025-01-02", days: 1 });
  });

  it("keeps the length over a daylight saving change", () => {
    const p = previousPeriodOf(customPeriod("2026-03-30", "2026-04-05"));
    expect(p).toMatchObject({ from: "2026-03-23", to: "2026-03-30", days: 7 });
  });
});

describe("same period last year", () => {
  it("shifts both ends by a year", () => {
    expect(lastYearOf(customPeriod("2026-03-01", "2026-03-31"))).toMatchObject({ from: "2025-03-01", to: "2025-04-01", days: 31 });
  });

  it("turns a start on 29 February into 28 February", () => {
    expect(lastYearOf(customPeriod("2024-02-29", "2024-02-29"))).toMatchObject({ from: "2023-02-28", to: "2023-03-01", days: 1 });
    expect(lastYearOf(customPeriod("2024-02-29", "2024-03-06"))).toMatchObject({ from: "2023-02-28", to: "2023-03-07", days: 7 });
  });

  it("is always as many days as the period itself, around a leap day too", () => {
    const cases: [string, string][] = [
      ["2024-02-01", "2024-02-29"],
      ["2025-02-01", "2025-02-28"],
      ["2025-02-25", "2025-03-03"],
      ["2025-02-23", "2025-03-01"],
      ["2028-02-25", "2028-03-02"],
      ["2027-03-01", "2027-03-31"],
      ["2024-01-01", "2024-12-31"],
      ["2025-01-01", "2025-12-31"],
    ];
    for (const [from, to] of cases) {
      const period = customPeriod(from, to);
      expect(lastYearOf(period).days, `${from}..${to}`).toBe(period.days);
    }
    expect(lastYearOf(customPeriod("2025-02-25", "2025-03-03"))).toMatchObject({ from: "2024-02-25", to: "2024-03-03", days: 7 });
    expect(lastYearOf(customPeriod("2028-02-25", "2028-03-02"))).toMatchObject({ from: "2027-02-25", to: "2027-03-04", days: 7 });
  });

  it("keeps the length when a year with a leap day is the year before", () => {
    expect(lastYearOf(customPeriod("2025-02-01", "2025-02-28"))).toMatchObject({ from: "2024-02-01", to: "2024-02-29", days: 28 });
    expect(lastYearOf(customPeriod("2025-03-01", "2025-03-01"))).toMatchObject({ from: "2024-03-01", days: 1 });
  });

  it("is labelled by its dates", () => {
    expect(lastYearOf(customPeriod("2026-03-01", "2026-03-31")).label).toBe("1 Mar – 31 Mar 2025");
  });
});

describe("labels", () => {
  it("names a day, a span and a span over a year's end", () => {
    expect(rangeLabel("2026-03-05", "2026-03-06")).toBe("5 Mar 2026");
    expect(rangeLabel("2026-03-05", "2026-03-10")).toBe("5 Mar – 9 Mar 2026");
    expect(rangeLabel("2025-12-20", "2026-01-03")).toBe("20 Dec 2025 – 2 Jan 2026");
  });
});

describe("periodQuery", () => {
  it("is empty for the default view", () => {
    expect(periodQuery(parse())).toBe("");
  });

  it("round-trips every preset and comparison", () => {
    for (const preset of PRESETS.filter((p) => p.id !== "custom")) {
      for (const compare of ["previous", "year", "none"]) {
        const a = parse({ period: preset.id, compare });
        const b = parse(Object.fromEntries(new URLSearchParams(periodQuery(a))));
        expect(b.period).toEqual(a.period);
        expect(b.compare.mode).toBe(a.compare.mode);
      }
    }
  });

  it("writes a custom span with an inclusive end and reads it back", () => {
    const a = parse({ period: "custom", from: "2026-03-01", to: "2026-03-31", compare: "year" });
    const text = periodQuery(a);
    expect(text).toBe("period=custom&from=2026-03-01&to=2026-03-31&compare=year");
    expect(parse(Object.fromEntries(new URLSearchParams(text))).period).toEqual(a.period);
  });

  it("builds links", () => {
    const a = parse({ period: "7d" });
    expect(periodHref("/admin/kaffe/analytics/finance", a)).toBe("/admin/kaffe/analytics/finance?period=7d");
    expect(periodHref("/x", parse())).toBe("/x");
    expect(periodHref("/x", parse(), { tab: "a" })).toBe("/x?tab=a");
  });
});

describe("buckets", () => {
  it("chooses by length", () => {
    expect(bucketFor({ days: 1 })).toBe("day");
    expect(bucketFor({ days: 45 })).toBe("day");
    expect(bucketFor({ days: 46 })).toBe("week");
    expect(bucketFor({ days: 200 })).toBe("week");
    expect(bucketFor({ days: 201 })).toBe("month");
    expect(bucketFor({ days: 800 })).toBe("month");
  });

  it("lists every day", () => {
    const b = enumerateBuckets(presetPeriod("7d", "2026-10-02"), "day");
    expect(b.map((x) => x.key)).toEqual(["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(b[0]).toMatchObject({ from: "2026-09-26", to: "2026-09-27", label: "26 Sep" });
  });

  it("lists days over a daylight saving change without skipping or doubling", () => {
    const b = enumerateBuckets({ from: "2026-03-27", to: "2026-04-01" }, "day");
    expect(b.map((x) => x.key)).toEqual(["2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
    const c = enumerateBuckets({ from: "2026-10-23", to: "2026-10-28" }, "day");
    expect(c).toHaveLength(5);
  });

  it("starts weeks on Monday and cuts the first and last to the period", () => {
    // Friday 2 Oct 2026 back 60 days to 4 Aug, a Tuesday.
    const b = enumerateBuckets({ from: "2026-08-04", to: "2026-10-03" }, "week");
    expect(b[0]).toMatchObject({ key: "2026-08-03", from: "2026-08-04", to: "2026-08-10", label: "Week of 3 Aug" });
    expect(b[1]).toMatchObject({ key: "2026-08-10", from: "2026-08-10", to: "2026-08-17" });
    expect(b.at(-1)).toMatchObject({ key: "2026-09-28", from: "2026-09-28", to: "2026-10-03" });
    expect(b).toHaveLength(9);
    // Consecutive buckets leave no gap and no overlap.
    for (let i = 1; i < b.length; i++) expect(b[i].from).toBe(b[i - 1].to);
  });

  it("makes a week of a period that ends on a Sunday", () => {
    const b = enumerateBuckets({ from: "2026-09-28", to: "2026-10-05" }, "week");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ key: "2026-09-28", to: "2026-10-05" });
  });

  it("starts a week in the year before", () => {
    const b = enumerateBuckets({ from: "2026-01-01", to: "2026-01-12" }, "week");
    expect(b.map((x) => x.key)).toEqual(["2025-12-29", "2026-01-05"]);
    expect(b[0].from).toBe("2026-01-01");
  });

  it("lists months with partial ends, over a short February", () => {
    const b = enumerateBuckets({ from: "2026-01-15", to: "2026-04-10" }, "month");
    expect(b.map((x) => [x.key, x.from, x.to, x.label])).toEqual([
      ["2026-01-01", "2026-01-15", "2026-02-01", "Jan 2026"],
      ["2026-02-01", "2026-02-01", "2026-03-01", "Feb 2026"],
      ["2026-03-01", "2026-03-01", "2026-04-01", "Mar 2026"],
      ["2026-04-01", "2026-04-01", "2026-04-10", "Apr 2026"],
    ]);
  });

  it("lists months across a year's end", () => {
    const b = enumerateBuckets({ from: "2025-11-01", to: "2026-02-01" }, "month");
    expect(b.map((x) => x.key)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01"]);
  });

  it("finds a day's bucket", () => {
    expect(bucketKey("2026-10-02", "day")).toBe("2026-10-02");
    expect(bucketKey("2026-10-02", "week")).toBe("2026-09-28");
    expect(bucketKey("2026-10-02", "month")).toBe("2026-10-01");
  });

  it("gives an empty list for an empty period", () => {
    expect(enumerateBuckets({ from: "2026-10-02", to: "2026-10-02" }, "day")).toEqual([]);
  });
});
