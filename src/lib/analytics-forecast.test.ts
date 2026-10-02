import { describe, expect, it } from "vitest";

import {
  forecastMonth,
  MIN_HISTORY_DAYS,
  RANGE_Z,
  SEASONAL_MAX,
  SEASONAL_MIN,
  weekdayProfile,
  type DailyValue,
} from "./analytics-forecast";

const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** 0 (Monday) to 6 (Sunday). */
const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** Days from `from` to `to`, both included, each valued by `f(day, index)`. */
function series(from: string, to: string, f: (day: string, i: number) => number): DailyValue[] {
  const out: DailyValue[] = [];
  for (let day = from, i = 0; day <= to; day = addDays(day, 1), i++) out.push({ day, value: f(day, i) });
  return out;
}

// 2026-09-01 is a Tuesday; September has 30 days; 2026-09-10 is a Thursday.
const SEPT = "2026-09-01";
const TODAY = "2026-09-10";
/** Fifty-six days before today and the days of the month up to it. */
const HISTORY_FROM = "2026-07-16";

describe("forecastMonth, a flat month", () => {
  const flat = series(HISTORY_FROM, TODAY, () => 1000);

  it("is what is banked plus the level for every day left, with no spread when every day is alike", () => {
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: flat });
    expect(f.soFarMinor).toBe(10_000); // 1-10 September
    expect(f.daysLeft).toBe(20);
    expect(f.expectedMinor).toBe(30_000);
    expect(f.lowMinor).toBe(30_000);
    expect(f.highMinor).toBe(30_000);
    expect(f.basis).toBe("weekday-run-rate");
    expect(f.seasonalFactor).toBeNull();
    expect(f.notes.length).toBeGreaterThan(0);
  });

  it("takes any day of the month as monthStart", () => {
    const f = forecastMonth({ monthStart: "2026-09-17", today: TODAY, dailyHistory: flat });
    expect(f.expectedMinor).toBe(30_000);
  });

  it("is the whole month when today is the last day and the day is over", () => {
    const f = forecastMonth({ monthStart: SEPT, today: "2026-09-30", dailyHistory: series(HISTORY_FROM, "2026-09-30", () => 1000) });
    expect(f.daysLeft).toBe(0);
    expect(f.soFarMinor).toBe(30_000);
    expect(f.expectedMinor).toBe(30_000);
    expect(f.lowMinor).toBe(30_000);
    expect(f.highMinor).toBe(30_000);
  });

  it("is what happened when the month is already over, never more", () => {
    const f = forecastMonth({ monthStart: SEPT, today: "2026-10-05", dailyHistory: series(HISTORY_FROM, "2026-10-05", (d) => (d <= "2026-09-30" ? 1000 : 5000)) });
    expect(f.daysLeft).toBe(0);
    expect(f.soFarMinor).toBe(30_000);
    expect(f.expectedMinor).toBe(30_000);
    expect(f.highMinor).toBe(30_000);
  });

  it("fills the whole month from the level when it has not begun, with nothing banked", () => {
    const f = forecastMonth({ monthStart: SEPT, today: "2026-08-28", dailyHistory: series("2026-07-03", "2026-08-28", () => 1000) });
    expect(f.soFarMinor).toBe(0);
    expect(f.daysLeft).toBe(30);
    expect(f.expectedMinor).toBe(30_000);
  });

  it("counts the part of today that has passed as banked and only the rest of today as still to come", () => {
    const partial = series(HISTORY_FROM, TODAY, (d) => (d === TODAY ? 400 : 1000));
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: partial, todayShare: 0.4 });
    expect(f.soFarMinor).toBe(9 * 1000 + 400);
    // 9 400 banked + 60 % of a 1 000 day + 20 whole days.
    expect(f.expectedMinor).toBe(9400 + 600 + 20_000);
    // Today counted as over (the default) leaves today's 400 as its whole.
    const over = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: partial });
    expect(over.expectedMinor).toBe(9400 + 20_000);
  });

  it("clamps a todayShare outside 0..1", () => {
    const base = { monthStart: SEPT, today: TODAY, dailyHistory: flat };
    expect(forecastMonth({ ...base, todayShare: 7 }).expectedMinor).toBe(30_000);
    expect(forecastMonth({ ...base, todayShare: -1 }).expectedMinor).toBe(31_000); // all of today still to come, on top of today's own row
    expect(forecastMonth({ ...base, todayShare: Number.NaN }).expectedMinor).toBe(30_000);
  });

  it("adds a repeated day up (per-currency rows) and ignores rows that are not real days or numbers", () => {
    const rows: DailyValue[] = [...flat.map((r) => ({ ...r, value: 500 })), ...flat.map((r) => ({ ...r, value: 500 })), { day: "2026-02-30", value: 9e9 }, { day: TODAY, value: Number.NaN }];
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: rows });
    expect(f.expectedMinor).toBe(30_000);
  });

  it("rejects a monthStart or today that is not a day", () => {
    expect(() => forecastMonth({ monthStart: "September", today: TODAY, dailyHistory: [] })).toThrow(RangeError);
    expect(() => forecastMonth({ monthStart: SEPT, today: "2026-13-01", dailyHistory: [] })).toThrow(RangeError);
  });
});

describe("forecastMonth, too little data", () => {
  it("gives nulls, never zero, below the minimum, but still says what has been banked", () => {
    // 13 whole days before today, then today.
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: series(addDays(TODAY, -13), TODAY, () => 1000) });
    expect(f.basis).toBe("too-little-data");
    expect(f.expectedMinor).toBeNull();
    expect(f.lowMinor).toBeNull();
    expect(f.highMinor).toBeNull();
    expect(f.soFarMinor).toBe(10_000);
    expect(f.daysLeft).toBe(20);
    expect(f.notes[0]).toMatch(/14 days/);
  });

  it("forecasts from exactly the minimum", () => {
    expect(MIN_HISTORY_DAYS).toBe(14);
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: series(addDays(TODAY, -14), TODAY, () => 1000) });
    expect(f.basis).toBe("weekday-run-rate");
    expect(f.expectedMinor).toBe(30_000);
  });

  it("does not count today, or days that are not given, as history", () => {
    // Fourteen days given, but today's row is among them: only thirteen are whole days before today.
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: series(addDays(TODAY, -13), TODAY, () => 1000) });
    expect(f.basis).toBe("too-little-data");
    // Fifty days given with every other one missing is twenty-five days of knowledge, enough.
    const sparse = series(addDays(TODAY, -50), TODAY, () => 1000).filter((_, i) => i % 2 === 0);
    expect(forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: sparse }).basis).toBe("weekday-run-rate");
  });

  it("has nothing to go on with no history at all", () => {
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: [] });
    expect(f.basis).toBe("too-little-data");
    expect(f.soFarMinor).toBe(0);
    expect(f.expectedMinor).toBeNull();
  });
});

describe("forecastMonth, the weekday profile", () => {
  /** Monday to Friday 100, Saturday 300, Sunday 200. */
  const heavy = (day: string) => [100, 100, 100, 100, 100, 300, 200][weekday(day)];
  const history = series(HISTORY_FROM, TODAY, (d) => heavy(d));

  it("fills each remaining day with its own weekday's level", () => {
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: history });
    let banked = 0;
    for (let d = SEPT; d <= TODAY; d = addDays(d, 1)) banked += heavy(d);
    let rest = 0;
    for (let d = addDays(TODAY, 1); d <= "2026-09-30"; d = addDays(d, 1)) rest += heavy(d);
    expect(rest).toBe(2900); // two whole weeks of 1 000 and Friday to Wednesday's 900
    expect(f.soFarMinor).toBe(banked);
    expect(f.expectedMinor).toBe(banked + rest);
    expect(f.lowMinor).toBe(f.expectedMinor);
    expect(f.basis).toBe("weekday-run-rate");
  });

  it("differs from treating every day alike, which would give 20 days at the mean of 142.86", () => {
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: history });
    const alike = Math.round(f.soFarMinor + 20 * (1000 / 7));
    expect(f.expectedMinor).not.toBe(alike);
  });

  it("needs four observations of every weekday, else every day counts alike", () => {
    // 27 days is 3 or 4 observations per weekday: one weekday short.
    const short = series(addDays(TODAY, -27), TODAY, (d) => heavy(d));
    expect(weekdayProfile(short.filter((r) => r.day < TODAY))).toBeNull();
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: short });
    // Level is the plain mean of the 27 whole days before today.
    const past = short.filter((r) => r.day < TODAY);
    const mean = past.reduce((a, r) => a + r.value, 0) / past.length;
    expect(f.expectedMinor).toBe(Math.round(f.soFarMinor + 20 * mean));
    expect(f.notes.join(" ")).toMatch(/every weekday counts alike/);
    // 28 days is four of each.
    const enough = series(addDays(TODAY, -28), TODAY, (d) => heavy(d));
    expect(weekdayProfile(enough.filter((r) => r.day < TODAY))).not.toBeNull();
  });

  it("weekdayProfile returns factors with a mean of 1 over the days seen, Monday first", () => {
    const p = weekdayProfile(history.filter((r) => r.day < TODAY)) as number[];
    expect(p).toHaveLength(7);
    expect(p[0]).toBeCloseTo(100 / (1000 / 7), 10);
    expect(p[5]).toBeCloseTo(300 / (1000 / 7), 10);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(7, 10);
  });

  it("gives no profile for no days or a history with no sales", () => {
    expect(weekdayProfile([])).toBeNull();
    expect(weekdayProfile(series(HISTORY_FROM, addDays(TODAY, -1), () => 0))).toBeNull();
  });

  it("copes with a weekday that never sells (a shop closed on Sundays)", () => {
    const closedSundays = series(HISTORY_FROM, TODAY, (d) => (weekday(d) === 6 ? 0 : 100));
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: closedSundays });
    let rest = 0;
    for (let d = addDays(TODAY, 1); d <= "2026-09-30"; d = addDays(d, 1)) rest += weekday(d) === 6 ? 0 : 100;
    expect(f.expectedMinor).toBe((f.soFarMinor as number) + rest);
  });
});

describe("forecastMonth, growth", () => {
  it("does not extrapolate a trend: a steadily growing shop is forecast under what it will do, but close", () => {
    const value = (_d: string, i: number) => 1000 + 2 * i;
    const history = series(HISTORY_FROM, TODAY, value);
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: history });
    const truth = series(SEPT, "2026-09-30", (d) => 1000 + 2 * Math.round((Date.parse(d) - Date.parse(HISTORY_FROM)) / DAY_MS)).reduce((a, r) => a + r.value, 0);
    expect(f.expectedMinor).toBeLessThan(truth);
    expect(f.expectedMinor).toBeGreaterThan(truth * 0.95);
    expect(f.lowMinor as number).toBeLessThanOrEqual(f.expectedMinor as number);
    expect(f.highMinor as number).toBeGreaterThan(f.expectedMinor as number);
  });
});

describe("forecastMonth, the range", () => {
  // 900 on even days, 1100 on odd ones: a spread around a level of 1000 that every weekday shares equally over eight weeks.
  const noisy = (to: string) => series(addDays(to, -56), to, (_d, i) => (i % 2 === 0 ? 900 : 1100));

  it("is worked out from the spread of the weekday-adjusted daily residuals and the days left", () => {
    // Fifty-six whole days before today, then today's own row.
    const history = noisy(TODAY);
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: history });
    const observed = history.filter((r) => r.day < TODAY);
    expect(observed).toHaveLength(56);
    const level = observed.reduce((a, r) => a + r.value, 0) / 56;
    expect(level).toBe(1000);
    const sigma = Math.sqrt(observed.reduce((a, r) => a + (r.value - level) ** 2, 0) / 55);
    const n = 20;
    const half = RANGE_Z * Math.sqrt(n * sigma ** 2 + (n * sigma) ** 2 / 56);
    const banked = f.soFarMinor as number;
    const expected = banked + 20 * 1000;
    expect(f.expectedMinor).toBe(expected);
    expect(f.lowMinor).toBe(Math.round(expected - half));
    expect(f.highMinor).toBe(Math.round(expected + half));
  });

  it("widens with the days left", () => {
    const width = (today: string) => {
      const f = forecastMonth({ monthStart: SEPT, today, dailyHistory: noisy(today) });
      return (f.highMinor as number) - (f.lowMinor as number);
    };
    const late = width("2026-09-25"); // 5 days left
    const middle = width("2026-09-15"); // 15 days left
    const early = width("2026-09-05"); // 25 days left
    expect(late).toBeGreaterThan(0);
    expect(middle).toBeGreaterThan(late);
    expect(early).toBeGreaterThan(middle);
  });

  it("is narrower for a steady shop than a jumpy one", () => {
    const calm = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: series(HISTORY_FROM, TODAY, (_d, i) => (i % 2 ? 1010 : 990)) });
    const jumpy = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: series(HISTORY_FROM, TODAY, (_d, i) => (i % 2 ? 1500 : 500)) });
    expect((calm.highMinor as number) - (calm.lowMinor as number)).toBeLessThan((jumpy.highMinor as number) - (jumpy.lowMinor as number));
  });

  it("keeps the expected figure inside the range and the low end at or above what is banked", () => {
    const jumpy = series(HISTORY_FROM, TODAY, (_d, i) => (i % 2 ? 3000 : 0));
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: jumpy });
    expect(f.lowMinor as number).toBeGreaterThanOrEqual(f.soFarMinor);
    expect(f.lowMinor as number).toBeLessThanOrEqual(f.expectedMinor as number);
    expect(f.highMinor as number).toBeGreaterThanOrEqual(f.expectedMinor as number);
  });

  it("includes the rest of today in how many days are left to be uncertain about", () => {
    const history = noisy(TODAY);
    const whole = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: history });
    const part = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: history, todayShare: 0.5 });
    expect((part.highMinor as number) - (part.lowMinor as number)).toBeGreaterThan((whole.highMinor as number) - (whole.lowMinor as number));
  });
});

describe("forecastMonth, never negative", () => {
  it("is zero, not below, when refunds made every day negative", () => {
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: series(HISTORY_FROM, TODAY, () => -100) });
    expect(f.expectedMinor).toBe(0);
    expect(f.lowMinor).toBe(0);
    expect(f.highMinor as number).toBeGreaterThanOrEqual(0);
    expect(f.soFarMinor).toBe(-1000); // what happened is reported as it was
  });

  it("is zero for a shop that sold nothing", () => {
    const f = forecastMonth({ monthStart: SEPT, today: TODAY, dailyHistory: series(HISTORY_FROM, TODAY, () => 0) });
    expect(f.basis).toBe("weekday-run-rate");
    expect(f.expectedMinor).toBe(0);
    expect(f.highMinor).toBe(0);
  });
});

describe("forecastMonth, last year's seasonality", () => {
  // December 2026 starts on a Tuesday. History: eight weeks of 1 000 before it, and the first day.
  const DEC = "2026-12-01";
  const history = series("2026-10-06", DEC, () => 1000);
  /** Last year: 1 000 a day, with the last ten days of December 2025 at `spike`. */
  const lastYear = (spike: number, from = "2025-10-06", to = "2025-12-31") => series(from, to, (d) => (d >= "2025-12-22" ? spike : 1000));

  it("scales the rest of the month by last year's month over the weeks before it: 30 days at 1 667 a day", () => {
    const f = forecastMonth({ monthStart: DEC, today: DEC, dailyHistory: history, lastYear: lastYear(3000) });
    // December 2 to 31 last year: 20 days of 1 000 and 10 of 3 000, 50 000 in 30 days, against 1 000 a day before.
    expect(f.seasonalFactor).toBeCloseTo(50_000 / 30 / 1000, 10);
    expect(f.basis).toBe("seasonal");
    expect(f.soFarMinor).toBe(1000);
    expect(f.expectedMinor).toBe(1000 + 50_000);
    expect(f.notes.join(" ")).toMatch(/Last year's pattern is applied/);
  });

  it("is the same forecast without last year, but flat", () => {
    const f = forecastMonth({ monthStart: DEC, today: DEC, dailyHistory: history });
    expect(f.basis).toBe("weekday-run-rate");
    expect(f.expectedMinor).toBe(31_000);
  });

  it("clamps a huge spike to a factor of 2 and a slump to 0.5, and says so", () => {
    const big = forecastMonth({ monthStart: DEC, today: DEC, dailyHistory: history, lastYear: lastYear(100_000) });
    expect(big.seasonalFactor).toBe(SEASONAL_MAX);
    expect(big.expectedMinor).toBe(1000 + 30 * 1000 * 2);
    expect(big.notes.join(" ")).toMatch(/limited/);
    const slump = forecastMonth({
      monthStart: DEC,
      today: DEC,
      dailyHistory: history,
      lastYear: series("2025-10-06", "2025-12-31", (d) => (d >= "2025-12-02" ? 10 : 1000)),
    });
    expect(slump.seasonalFactor).toBe(SEASONAL_MIN);
    expect(slump.expectedMinor).toBe(1000 + 30 * 1000 * 0.5);
  });

  it("is applied to the days left only, mid-month: last year's remaining days over the same eight weeks", () => {
    const today = "2026-12-15"; // 16 days left (16-31)
    const hist = series("2026-10-20", today, () => 1000);
    // Last year's 16 to 31 December (shifted back a year: 2025-12-16..31): 6 days of 1 000 and 10 of 2 000.
    const f = forecastMonth({ monthStart: DEC, today, dailyHistory: hist, lastYear: lastYear(2000, "2025-10-01") });
    expect(f.daysLeft).toBe(16);
    expect(f.seasonalFactor).toBeCloseTo((6 * 1000 + 10 * 2000) / 16 / 1000, 10);
    expect(f.expectedMinor).toBe(15 * 1000 + Math.round(16 * 1000 * f.seasonalFactor!));
  });

  it("is not used when last year's data does not reach back eight weeks, or has holes", () => {
    const short = forecastMonth({ monthStart: DEC, today: DEC, dailyHistory: history, lastYear: lastYear(3000, "2025-11-20") });
    expect(short.basis).toBe("weekday-run-rate");
    expect(short.seasonalFactor).toBeNull();
    expect(short.expectedMinor).toBe(31_000);
    expect(short.notes.join(" ")).toMatch(/not complete enough/);
    const holes = lastYear(3000).filter((_, i) => i % 3 !== 0);
    expect(forecastMonth({ monthStart: DEC, today: DEC, dailyHistory: history, lastYear: holes }).basis).toBe("weekday-run-rate");
  });

  it("is not used when last year does not cover the days left", () => {
    const f = forecastMonth({ monthStart: DEC, today: DEC, dailyHistory: history, lastYear: lastYear(3000, "2025-10-06", "2025-12-15") });
    expect(f.basis).toBe("weekday-run-rate");
    expect(f.notes.join(" ")).toMatch(/not complete enough/);
  });

  it("is not used when little was sold in the weeks before last year's month", () => {
    // Sales on 20 of the 56 days, below the 28 needed.
    const thin = series("2025-10-06", "2025-12-31", (d) => (d >= "2025-12-01" ? 1000 : Number(d.slice(8, 10)) % 3 === 0 ? 1000 : 0));
    const f = forecastMonth({ monthStart: DEC, today: DEC, dailyHistory: history, lastYear: thin });
    expect(f.basis).toBe("weekday-run-rate");
    expect(f.notes.join(" ")).toMatch(/too little was sold/);
  });

  it("is not used when nothing at all was sold in the weeks before", () => {
    const nothing = series("2025-10-06", "2025-12-31", (d) => (d >= "2025-12-01" ? 1000 : 0));
    const f = forecastMonth({ monthStart: DEC, today: DEC, dailyHistory: history, lastYear: nothing });
    expect(f.basis).toBe("weekday-run-rate");
  });

  it("is not used with fewer than five days left, where it would only be noise", () => {
    const today = "2026-12-27"; // 4 days left
    const hist = series("2026-11-01", today, () => 1000);
    const f = forecastMonth({ monthStart: DEC, today, dailyHistory: hist, lastYear: lastYear(3000, "2025-10-01") });
    expect(f.daysLeft).toBe(4);
    expect(f.basis).toBe("weekday-run-rate");
    expect(f.notes.join(" ")).toMatch(/too few days/);
    // Exactly five days left is enough.
    const five = forecastMonth({ monthStart: DEC, today: "2026-12-26", dailyHistory: series("2026-11-01", "2026-12-26", () => 1000), lastYear: lastYear(3000, "2025-10-01") });
    expect(five.daysLeft).toBe(5);
    expect(five.basis).toBe("seasonal");
  });

  it("is not used when there is not enough of this year's history to forecast at all", () => {
    const f = forecastMonth({ monthStart: DEC, today: DEC, dailyHistory: series("2026-11-25", DEC, () => 1000), lastYear: lastYear(3000) });
    expect(f.basis).toBe("too-little-data");
    expect(f.seasonalFactor).toBeNull();
  });

  it("widens the range with the factor", () => {
    const noisy = series("2026-10-06", DEC, (_d, i) => (i % 2 ? 1100 : 900));
    const plain = forecastMonth({ monthStart: DEC, today: DEC, dailyHistory: noisy });
    const seasonal = forecastMonth({ monthStart: DEC, today: DEC, dailyHistory: noisy, lastYear: lastYear(3000) });
    expect((seasonal.highMinor as number) - (seasonal.lowMinor as number)).toBeGreaterThan((plain.highMinor as number) - (plain.lowMinor as number));
  });
});
