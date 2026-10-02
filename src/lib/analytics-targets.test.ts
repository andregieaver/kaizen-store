import { describe, expect, it } from "vitest";

import { MIN_DAYS_FOR_VERDICT, targetProgress, weekdayWeights, type DailyActual } from "./analytics-targets";

// September 2026 has 30 days and starts on a Tuesday; 2026-08-03 is a Monday.
const SEPT = "2026-09-01";

/** `n` consecutive days from `start`, each given by `revenue(weekday 0-6 Monday first)`. */
function history(start: string, n: number, revenue: (weekday: number) => number): DailyActual[] {
  const out: DailyActual[] = [];
  const first = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    const date = new Date(first + i * 86_400_000);
    out.push({ day: date.toISOString().slice(0, 10), revenueMinor: revenue((date.getUTCDay() + 6) % 7) });
  }
  return out;
}

const WEEKDAYS_ONLY = (weekday: number) => (weekday < 5 ? 100 : 0);

describe("targetProgress, evenly by day", () => {
  const base = { targetMinor: 300_000, monthStart: SEPT, today: "2026-09-10" };

  it("expects a linear share: 10 of 30 days of 300 000 is 100 000", () => {
    const p = targetProgress({ ...base, actualMinor: 110_000 });
    expect(p.expectedByTodayMinor).toBe(100_000);
    expect(p.aheadByMinor).toBe(10_000);
    expect(p.aheadByPct).toBeCloseTo(0.1, 10);
    expect(p.pct).toBeCloseTo(110_000 / 300_000, 10);
    expect(p.projectedMinor).toBe(330_000);
    expect(p.projectedPct).toBeCloseTo(1.1, 10);
    expect(p.status).toBe("ahead");
    expect(p.weekdayWeighted).toBe(false);
    expect(p.daysInMonth).toBe(30);
    expect(p.daysLeft).toBe(20);
    expect(p.tooEarly).toBe(false);
  });

  it("is on track within 3 % of what was expected, either way, and the edge is on track", () => {
    expect(targetProgress({ ...base, actualMinor: 102_000 }).status).toBe("on_track");
    expect(targetProgress({ ...base, actualMinor: 103_000 }).status).toBe("on_track");
    expect(targetProgress({ ...base, actualMinor: 97_000 }).status).toBe("on_track");
    expect(targetProgress({ ...base, actualMinor: 103_001 }).status).toBe("ahead");
    expect(targetProgress({ ...base, actualMinor: 96_999 }).status).toBe("behind");
    expect(targetProgress({ ...base, actualMinor: 90_000 }).status).toBe("behind");
  });

  it("says ahead whenever the whole target is already sold", () => {
    expect(targetProgress({ ...base, today: "2026-09-02", actualMinor: 300_000 }).status).toBe("ahead");
    expect(targetProgress({ ...base, today: "2026-09-30", actualMinor: 301_000 }).status).toBe("ahead");
  });

  it("counts today for the part of it that has passed", () => {
    const p = targetProgress({ ...base, actualMinor: 95_000, todayShare: 0.5 });
    expect(p.expectedByTodayMinor).toBe(95_000);
    expect(p.status).toBe("on_track");
    // out of range or missing shares are a whole day / clamped
    expect(targetProgress({ ...base, actualMinor: 0, todayShare: 5 }).expectedByTodayMinor).toBe(100_000);
    expect(targetProgress({ ...base, actualMinor: 0, todayShare: -1 }).expectedByTodayMinor).toBe(90_000);
    expect(targetProgress({ ...base, actualMinor: 0, todayShare: Number.NaN }).expectedByTodayMinor).toBe(100_000);
  });

  it("has no expectation or projection before any of the month has passed", () => {
    const p = targetProgress({ ...base, today: "2026-09-01", todayShare: 0, actualMinor: 0 });
    expect(p.expectedByTodayMinor).toBe(0);
    expect(p.aheadByPct).toBeNull();
    expect(p.projectedMinor).toBeNull();
    expect(p.projectedPct).toBeNull();
    expect(p.status).toBe("on_track");
    expect(p.tooEarly).toBe(true);
  });

  it("is before the month: nothing expected, every day left", () => {
    const p = targetProgress({ ...base, today: "2026-08-20", actualMinor: 0 });
    expect(p.expectedByTodayMinor).toBe(0);
    expect(p.daysLeft).toBe(30);
    expect(p.projectedMinor).toBeNull();
    expect(p.status).toBe("on_track");
  });

  it("is after the month: the whole target was expected and no days are left", () => {
    const behind = targetProgress({ ...base, today: "2026-10-02", actualMinor: 250_000 });
    expect(behind.expectedByTodayMinor).toBe(300_000);
    expect(behind.daysLeft).toBe(0);
    expect(behind.status).toBe("behind");
    expect(behind.projectedMinor).toBe(250_000);
    expect(behind.tooEarly).toBe(false);
    expect(targetProgress({ ...base, today: "2026-10-02", actualMinor: 292_000 }).status).toBe("on_track");
  });

  it("knows the last day of the month and of a leap February", () => {
    expect(targetProgress({ ...base, today: "2026-09-30", actualMinor: 0 }).daysLeft).toBe(0);
    const feb = targetProgress({ targetMinor: 290_000, monthStart: "2028-02-01", today: "2028-02-29", actualMinor: 290_000 });
    expect(feb.daysInMonth).toBe(29);
    expect(feb.daysLeft).toBe(0);
    expect(targetProgress({ targetMinor: 280_000, monthStart: "2026-02-01", today: "2026-02-14", actualMinor: 0 }).expectedByTodayMinor).toBe(140_000);
  });

  it("takes any day of the month as its start", () => {
    const a = targetProgress({ ...base, monthStart: "2026-09-17", actualMinor: 110_000 });
    const b = targetProgress({ ...base, actualMinor: 110_000 });
    expect(a).toEqual(b);
  });

  it("flags the first days as too early to judge", () => {
    expect(MIN_DAYS_FOR_VERDICT).toBe(3);
    expect(targetProgress({ ...base, today: "2026-09-02", actualMinor: 1 }).tooEarly).toBe(true);
    expect(targetProgress({ ...base, today: "2026-09-03", actualMinor: 1 }).tooEarly).toBe(false);
    expect(targetProgress({ ...base, today: "2026-09-03", todayShare: 0.5, actualMinor: 1 }).tooEarly).toBe(true);
  });

  it("handles a negative net revenue without inventing a status", () => {
    const p = targetProgress({ ...base, actualMinor: -5000 });
    expect(p.pct).toBeCloseTo(-5000 / 300_000, 10);
    expect(p.status).toBe("behind");
    expect(p.projectedMinor).toBe(-15_000);
  });
});

describe("targetProgress, no target", () => {
  it("is no_target for null, zero, negative and non-finite targets, with the figures that need none", () => {
    for (const targetMinor of [null, 0, -100, Number.NaN]) {
      const p = targetProgress({ targetMinor, actualMinor: 50_000, monthStart: SEPT, today: "2026-09-15" });
      expect(p.status).toBe("no_target");
      expect(p.targetMinor).toBeNull();
      expect(p.pct).toBeNull();
      expect(p.expectedByTodayMinor).toBeNull();
      expect(p.aheadByMinor).toBeNull();
      expect(p.aheadByPct).toBeNull();
      expect(p.projectedPct).toBeNull();
      expect(p.projectedMinor).toBe(100_000);
      expect(p.daysLeft).toBe(15);
    }
  });
});

describe("weekday weighting", () => {
  // Mon-Fri 100, weekends 0, four whole weeks from Monday 2026-08-03.
  const four = history("2026-08-03", 28, WEEKDAYS_ONLY);

  it("works out each weekday's mean, Monday first", () => {
    expect(weekdayWeights(four, "2026-09-08")).toEqual([100, 100, 100, 100, 100, 0, 0]);
    // the mean, not the sum: eight weeks of the same pattern give the same weights
    expect(weekdayWeights(history("2026-07-06", 56, WEEKDAYS_ONLY), "2026-09-08")).toEqual([100, 100, 100, 100, 100, 0, 0]);
  });

  it("weights the month by its weekdays: a month of five Tuesdays and Wednesdays expects 6 of 22 by the 8th", () => {
    // Sept 1-8 holds Tue, Wed, Thu, Fri, Sat, Sun, Mon, Tue: 6 working days of the month's 22.
    const p = targetProgress({ targetMinor: 220_000, actualMinor: 60_000, monthStart: SEPT, today: "2026-09-08", dailyActuals: four });
    expect(p.weekdayWeighted).toBe(true);
    expect(p.shareElapsed).toBeCloseTo(6 / 22, 10);
    expect(p.expectedByTodayMinor).toBe(60_000);
    expect(p.status).toBe("on_track");
    expect(p.projectedMinor).toBe(220_000);
    // evenly by day the same sales would have looked ahead: 8/30 of 220 000 is 58 667
    const even = targetProgress({ targetMinor: 220_000, actualMinor: 60_000, monthStart: SEPT, today: "2026-09-08" });
    expect(even.expectedByTodayMinor).toBe(58_667);
  });

  it("weights today by its share: half of a Tuesday", () => {
    const p = targetProgress({ targetMinor: 220_000, actualMinor: 0, monthStart: SEPT, today: "2026-09-08", todayShare: 0.5, dailyActuals: four });
    expect(p.shareElapsed).toBeCloseTo(5.5 / 22, 10);
  });

  it("reads only days before today", () => {
    const withToday = [...four, { day: "2026-09-08", revenueMinor: 9_999_999 }, { day: "2026-09-09", revenueMinor: 9_999_999 }];
    expect(weekdayWeights(withToday, "2026-09-08")).toEqual([100, 100, 100, 100, 100, 0, 0]);
  });

  it("adds a day given in several rows", () => {
    const split = four.flatMap((d) => [
      { day: d.day, revenueMinor: d.revenueMinor / 2 },
      { day: d.day, revenueMinor: d.revenueMinor / 2 },
    ]);
    expect(weekdayWeights(split, "2026-09-08")).toEqual([100, 100, 100, 100, 100, 0, 0]);
  });

  it("is not used with under four weeks of days", () => {
    expect(weekdayWeights(four.slice(0, 27), "2026-09-08")).toBeNull();
    expect(weekdayWeights([], "2026-09-08")).toBeNull();
    expect(weekdayWeights(undefined, "2026-09-08")).toBeNull();
    const p = targetProgress({ targetMinor: 220_000, actualMinor: 60_000, monthStart: SEPT, today: "2026-09-08", dailyActuals: four.slice(0, 27) });
    expect(p.weekdayWeighted).toBe(false);
  });

  it("is not used when some weekday is seen under four times, however many days there are", () => {
    // 30 distinct days, none of them a weekend
    const sparse = history("2026-06-01", 42, (w) => w).filter((d) => (new Date(`${d.day}T00:00:00Z`).getUTCDay() + 6) % 7 < 5);
    expect(sparse.length).toBe(30);
    expect(weekdayWeights(sparse, "2026-09-08")).toBeNull();
  });

  it("is not used when the history has no sales, or sells backwards", () => {
    expect(weekdayWeights(history("2026-08-03", 28, () => 0), "2026-09-08")).toBeNull();
    expect(weekdayWeights(history("2026-08-03", 28, () => -50), "2026-09-08")).toBeNull();
  });

  it("never counts a weekday backwards", () => {
    const weights = weekdayWeights(history("2026-08-03", 28, (w) => (w === 6 ? -500 : 100)), "2026-09-08");
    expect(weights).toEqual([100, 100, 100, 100, 100, 100, 0]);
  });

  it("ignores rows that are not real days or not finite", () => {
    const noisy = [...four, { day: "2026-02-30", revenueMinor: 5 }, { day: "garbage", revenueMinor: 5 }, { day: "2026-08-01", revenueMinor: Number.NaN }];
    expect(weekdayWeights(noisy, "2026-09-08")).toEqual([100, 100, 100, 100, 100, 0, 0]);
    expect(weekdayWeights(four, "not a day")).toBeNull();
  });
});

describe("invalid days", () => {
  it("throws on a day that does not exist, rather than guessing", () => {
    expect(() => targetProgress({ targetMinor: 1, actualMinor: 0, monthStart: "2026-02-30", today: "2026-02-10" })).toThrow(RangeError);
    expect(() => targetProgress({ targetMinor: 1, actualMinor: 0, monthStart: SEPT, today: "yesterday" })).toThrow(RangeError);
  });
});
