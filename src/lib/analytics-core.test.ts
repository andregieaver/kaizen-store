import { describe, expect, it } from "vitest";

import {
  change,
  changePoints,
  formatChange,
  formatCount,
  formatDate,
  formatMonth,
  formatNumber,
  formatPercent,
  formatPoints,
  formatSigned,
  groupThousands,
  MINUS,
  MONTH_SHORT,
  roundedText,
  NO_FIGURE,
  normalise,
  safeRatio,
  sparklinePath,
  sparklinePoints,
  toMain,
  verdictOf,
  withMinus,
} from "./analytics-core";
import { toRates } from "./currency";

describe("safeRatio", () => {
  it("divides", () => {
    expect(safeRatio(1, 4)).toBe(0.25);
    expect(safeRatio(0, 4)).toBe(0);
    expect(safeRatio(-1, 4)).toBe(-0.25);
  });

  it("is null when it cannot be known", () => {
    expect(safeRatio(1, 0)).toBeNull();
    expect(safeRatio(0, 0)).toBeNull();
    expect(safeRatio(null, 4)).toBeNull();
    expect(safeRatio(4, null)).toBeNull();
    expect(safeRatio(undefined, 4)).toBeNull();
    expect(safeRatio(NaN, 4)).toBeNull();
    expect(safeRatio(1, Infinity)).toBeNull();
  });
});

describe("change", () => {
  it("is the difference and its ratio", () => {
    expect(change(112, 100)).toEqual({ abs: 12, pct: 0.12 });
    expect(change(50, 100)).toEqual({ abs: -50, pct: -0.5 });
    expect(change(100, 100)).toEqual({ abs: 0, pct: 0 });
  });

  it("has no percentage from nothing", () => {
    expect(change(10, 0)).toEqual({ abs: 10, pct: null });
    expect(change(0, 0)).toEqual({ abs: 0, pct: null });
  });

  it("is null when either side is unknown, not a change from zero", () => {
    expect(change(10, null)).toBeNull();
    expect(change(10, undefined)).toBeNull();
    expect(change(null, 10)).toBeNull();
    expect(change(NaN, 10)).toBeNull();
  });

  it("measures a negative previous by its size, so a smaller loss is an improvement", () => {
    expect(change(-50, -100)).toEqual({ abs: 50, pct: 0.5 });
    expect(change(-150, -100)).toEqual({ abs: -50, pct: -0.5 });
    expect(change(20, -100)).toEqual({ abs: 120, pct: 1.2 });
  });

  it("changes a share in points", () => {
    expect(changePoints(0.034, 0.03)).toBeCloseTo(0.4, 10);
    expect(changePoints(0.03, 0.034)).toBeCloseTo(-0.4, 10);
    expect(changePoints(null, 0.03)).toBeNull();
    expect(changePoints(0.03, undefined)).toBeNull();
  });
});

describe("writing figures", () => {
  it("writes a percentage with a space", () => {
    expect(formatPercent(0.834)).toBe("83.4 %");
    expect(formatPercent(0.834, 0)).toBe("83 %");
    expect(formatPercent(1)).toBe("100.0 %");
    expect(formatPercent(0)).toBe("0.0 %");
    expect(formatPercent(1.5, 0)).toBe("150 %");
    expect(formatPercent(0.0345, 2)).toBe("3.45 %");
  });

  it("writes no figure for what is unknown", () => {
    expect(formatPercent(null)).toBe(NO_FIGURE);
    expect(formatPercent(undefined)).toBe(NO_FIGURE);
    expect(formatPercent(NaN)).toBe(NO_FIGURE);
    expect(formatPercent(Infinity)).toBe(NO_FIGURE);
  });

  it("rounds half away from zero and never writes minus zero", () => {
    expect(formatPercent(0.0005, 1)).toBe("0.1 %");
    expect(formatPercent(-0.0005, 1)).toBe("−0.1 %");
    expect(formatPercent(-0.00004, 1)).toBe("0.0 %");
    expect(formatSigned(-0.00004, 1)).toBe("0.0 %");
  });

  it("signs changes", () => {
    expect(formatSigned(0.124)).toBe("+12.4 %");
    expect(formatSigned(-0.032)).toBe("−3.2 %");
    expect(formatSigned(0)).toBe("0.0 %");
    expect(formatSigned(null)).toBe(NO_FIGURE);
  });

  it("writes a change without an arrow", () => {
    expect(formatChange(change(112.4, 100))).toBe("+12.4 %");
    expect(formatChange(change(96.8, 100))).toBe("−3.2 %");
    expect(formatChange(change(100, 100))).toBe("0.0 %");
    expect(formatChange(change(112.4, 100), 0)).toBe("+12 %");
  });

  it("says what a change from nothing is", () => {
    expect(formatChange(change(5, 0))).toBe("new");
    expect(formatChange(change(0, 0))).toBe("0.0 %");
    expect(formatChange(change(-5, 0))).toBe(NO_FIGURE);
    expect(formatChange(null)).toBe(NO_FIGURE);
    expect(formatChange(undefined)).toBe(NO_FIGURE);
  });

  it("writes points", () => {
    expect(formatPoints(0.4)).toBe("+0.4 pts");
    expect(formatPoints(-1.25, 2)).toBe("−1.25 pts");
    expect(formatPoints(0)).toBe("0.0 pts");
    expect(formatPoints(-0.0001)).toBe("0.0 pts");
    expect(formatPoints(null)).toBe(NO_FIGURE);
  });

  it("writes counts with no-break spaces between thousands", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1 000");
    expect(formatCount(1234567)).toBe("1 234 567");
    expect(formatCount(-12345)).toBe("−12 345");
    expect(formatCount(12.6)).toBe("13");
    expect(formatCount(null)).toBe(NO_FIGURE);
  });
});

describe("verdictOf", () => {
  it("is good when a figure moves the way it should", () => {
    expect(verdictOf(5, "up")).toBe("good");
    expect(verdictOf(-5, "up")).toBe("bad");
    expect(verdictOf(-5, "down")).toBe("good");
    expect(verdictOf(5, "down")).toBe("bad");
  });

  it("is neutral without a direction, a change or a real move", () => {
    expect(verdictOf(5, "neutral")).toBe("neutral");
    expect(verdictOf(0, "up")).toBe("neutral");
    expect(verdictOf(null, "up")).toBe("neutral");
    expect(verdictOf(undefined, "down")).toBe("neutral");
    expect(verdictOf(NaN, "up")).toBe("neutral");
  });

  it("leaves noise unpainted within epsilon", () => {
    expect(verdictOf(0.4, "up", 0.5)).toBe("neutral");
    expect(verdictOf(-0.5, "up", 0.5)).toBe("neutral");
    expect(verdictOf(0.6, "up", 0.5)).toBe("good");
    expect(verdictOf(-0.6, "up", 0.5)).toBe("bad");
  });
});

describe("toMain", () => {
  const rates = toRates([
    { currency: "NOK", rate: 11.5, roundTo: 1 },
    { currency: "SEK", rate: 11, roundTo: 1 },
    { currency: "DKK", rate: null, roundTo: 1 },
  ]);

  it("sums amounts already in the main currency as they are", () => {
    expect(toMain([{ currency: "NOK", minor: 1000 }, { currency: "NOK", minor: 250 }], "NOK", rates)).toEqual({ minor: 1250, unconverted: 0, missing: [] });
  });

  it("converts the others at the store's rates", () => {
    // 1100 öre of SEK is 100 EUR cents' worth at 11 per euro, and 115 øre at 11.5.
    const total = toMain([{ currency: "NOK", minor: 1000 }, { currency: "SEK", minor: 1100 }], "NOK", rates);
    expect(total).toEqual({ minor: 1000 + 1150, unconverted: 0, missing: [] });
  });

  it("converts through the euro", () => {
    expect(toMain([{ currency: "EUR", minor: 100 }], "NOK", rates).minor).toBe(1150);
    expect(toMain([{ currency: "NOK", minor: 1150 }], "EUR", rates).minor).toBe(100);
  });

  it("counts, and does not sum, a currency with no rate", () => {
    const total = toMain([{ currency: "NOK", minor: 1000 }, { currency: "DKK", minor: 5000 }, { currency: "PLN", minor: 700 }], "NOK", rates);
    expect(total).toEqual({ minor: 1000, unconverted: 2, missing: ["DKK", "PLN"] });
  });

  it("names a currency once but counts each amount", () => {
    const total = toMain([{ currency: "DKK", minor: 1 }, { currency: "DKK", minor: 2 }], "NOK", rates);
    expect(total).toEqual({ minor: 0, unconverted: 2, missing: ["DKK"] });
  });

  it("does not count an amount of zero, which loses nothing", () => {
    expect(toMain([{ currency: "DKK", minor: 0 }], "NOK", rates)).toEqual({ minor: 0, unconverted: 0, missing: [] });
  });

  it("handles nothing and negative amounts such as refunds", () => {
    expect(toMain([], "NOK", rates)).toEqual({ minor: 0, unconverted: 0, missing: [] });
    expect(toMain([{ currency: "SEK", minor: -1100 }, { currency: "NOK", minor: 2000 }], "NOK", rates).minor).toBe(850);
  });

  it("leaves everything out when the main currency has no rate", () => {
    const total = toMain([{ currency: "NOK", minor: 1000 }, { currency: "SEK", minor: 1000 }], "DKK", rates);
    expect(total).toMatchObject({ minor: 0, unconverted: 2 });
  });
});

describe("sparklines", () => {
  it("scales to 0..1", () => {
    expect(normalise([10, 20, 30])).toEqual([0, 0.5, 1]);
    expect(normalise([30, 10])).toEqual([1, 0]);
    expect(normalise([-5, 5])).toEqual([0, 1]);
  });

  it("puts a flat series and a single point in the middle", () => {
    expect(normalise([7, 7, 7])).toEqual([0.5, 0.5, 0.5]);
    expect(normalise([0, 0])).toEqual([0.5, 0.5]);
    expect(normalise([42])).toEqual([0.5]);
  });

  it("keeps gaps and ignores them in the scale", () => {
    expect(normalise([null, 10, null, 20])).toEqual([null, 0, null, 1]);
    expect(normalise([null, 5, null])).toEqual([null, 0.5, null]);
    expect(normalise([null, null])).toEqual([null, null]);
    expect(normalise([])).toEqual([]);
  });

  it("places points with the highest at the top", () => {
    const p = sparklinePoints([0, 10], 100, 20, 2);
    expect(p).toEqual([
      { x: 2, y: 18 },
      { x: 98, y: 2 },
    ]);
  });

  it("centres a single point and a flat line", () => {
    expect(sparklinePoints([5], 100, 20, 2)).toEqual([{ x: 50, y: 10 }]);
    expect(sparklinePoints([5, 5, 5], 100, 20, 2).map((q) => q?.y)).toEqual([10, 10, 10]);
    expect(sparklinePoints([], 100, 20)).toEqual([]);
  });

  it("copes with a box smaller than its padding", () => {
    const p = sparklinePoints([1, 2], 2, 2, 4);
    expect(p.every((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true);
  });

  it("draws a path and lifts the pen at gaps", () => {
    expect(sparklinePath(sparklinePoints([0, 10, 5], 100, 20, 2))).toBe("M2 18L50 2L98 10");
    expect(sparklinePath([{ x: 1, y: 2 }, null, { x: 3, y: 4 }, { x: 5, y: 6 }])).toBe("M1 2h0M3 4L5 6");
    expect(sparklinePath([])).toBe("");
    expect(sparklinePath([null, null])).toBe("");
  });

  it("gives a lone point a zero-length line so it shows", () => {
    expect(sparklinePath([{ x: 50, y: 10 }])).toBe("M50 10h0");
  });
});

describe("one way to write a number", () => {
  const NB = "\u00a0";

  it("groups thousands with a no-break space and decimals with a point, for every kind of number", () => {
    expect(formatNumber(1234.56, 1)).toBe(`1${NB}234.6`);
    expect(formatNumber(1234.56)).toBe(`1${NB}235`);
    expect(formatNumber(-1234567.891, 2)).toBe(`−1${NB}234${NB}567.89`);
    expect(formatNumber(0.5, 2)).toBe("0.50");
    expect(formatNumber(null)).toBe(NO_FIGURE);
    expect(formatNumber(Number.NaN, 1)).toBe(NO_FIGURE);
    expect(formatNumber(-0.0001, 1)).toBe("0.0");
  });

  it("writes a count, a percentage, a change and points with the same digits and separators", () => {
    // 1 234.5 in each kind of figure: the same grouping and the same point.
    expect(formatCount(1234.5)).toBe(`1${NB}235`);
    expect(formatNumber(1234.5, 1)).toBe(`1${NB}234.5`);
    expect(formatPercent(12.345, 1)).toBe(`1${NB}234.5 %`);
    expect(formatSigned(12.345, 1)).toBe(`+1${NB}234.5 %`);
    expect(formatSigned(-12.345, 1)).toBe(`−1${NB}234.5 %`);
    expect(formatPoints(1234.5, 1)).toBe(`+1${NB}234.5 pts`);
    expect(formatChange({ abs: 1, pct: 12.345 }, 1)).toBe(`+1${NB}234.5 %`);
    // Under a thousand nothing changes.
    expect(formatPercent(0.834)).toBe("83.4 %");
    expect(formatSigned(0.124)).toBe("+12.4 %");
    expect(formatSigned(-0.032)).toBe("−3.2 %");
    expect(formatSigned(0.0004)).toBe("0.0 %");
    expect(formatPoints(-0.4)).toBe("−0.4 pts");
  });

  it("never depends on the locale of the runtime", () => {
    for (const n of [0, 5, 999, 1000, 1234.5, 98765432.1, -4240]) {
      expect(formatNumber(n, 1)).toBe(groupThousands(roundedText(n, 1)));
      expect(formatNumber(n, 1)).not.toMatch(/,/);
    }
  });

  it("rounds half away from zero, as every figure does", () => {
    expect(roundedText(2.5, 0)).toBe("3");
    expect(roundedText(-2.5, 0)).toBe("-3");
    expect(roundedText(0.125, 2)).toBe("0.13");
    expect(roundedText(-0.00001, 2)).toBe("0.00");
  });

  it("groups only the whole part", () => {
    expect(groupThousands("1234.5678")).toBe(`1${NB}234.5678`);
    expect(groupThousands("-999")).toBe("−999");
    expect(groupThousands("100000")).toBe(`100${NB}000`);
  });
});

describe("the minus sign", () => {
  it("is the proper minus, U+2212, in every figure the formatters write", () => {
    expect(MINUS).toBe("\u2212");
    for (const text of [formatNumber(-5, 1), formatPercent(-0.5), formatSigned(-0.5), formatPoints(-2), formatCount(-1200), formatChange(change(50, 100))]) {
      expect(text).toContain(MINUS);
      expect(text).not.toContain("-");
    }
    // No minus is written where the figure rounds to nothing.
    expect(formatSigned(-0.00001)).toBe("0.0 %");
    expect(formatNumber(-0.04, 1)).toBe("0.0");
  });

  it("makes a hyphen-minus before a number or an amount the proper minus, and nothing else", () => {
    expect(withMinus("-3.2 %")).toBe("\u22123.2 %");
    expect(withMinus("-$5.00")).toBe("\u2212$5.00");
    expect(withMinus("$-5.00")).toBe("$\u22125.00");
    expect(withMinus("-NOK 1,500.00")).toBe("\u2212NOK 1,500.00");
    expect(withMinus("kr -5,00")).toBe("kr \u22125,00");
    expect(withMinus("(-5)")).toBe("(\u22125)");
    expect(withMinus("-1\u00a0234,00\u00a0kr")).toBe("\u22121\u00a0234,00\u00a0kr");
    // A range, a hyphenated word, a date and an already proper minus are left as they are.
    expect(withMinus("1–30 Sep")).toBe("1–30 Sep");
    expect(withMinus("2026-09-30")).toBe("2026-09-30");
    expect(withMinus("year-on-year")).toBe("year-on-year");
    expect(withMinus("\u22125")).toBe("\u22125");
  });
});

describe("month and day labels", () => {
  it("writes the short month names with 'Sep', never 'Sept', whatever the runtime's ICU says", () => {
    expect(MONTH_SHORT).toHaveLength(12);
    expect(MONTH_SHORT[8]).toBe("Sep");
    expect(formatMonth("2026-09")).toBe("Sep 2026");
    expect(formatDate("2026-09-03")).toBe("3 Sep 2026");
    expect(MONTH_SHORT.map((m, i) => formatMonth(`2026-${String(i + 1).padStart(2, "0")}`))).toEqual(MONTH_SHORT.map((m) => `${m} 2026`));
  });

  it("gives back what is not a month or a real day as it came", () => {
    expect(formatMonth("2026-13")).toBe("2026-13");
    expect(formatMonth("soon")).toBe("soon");
    expect(formatDate("2026-02-30")).toBe("2026-02-30");
    expect(formatDate("soon")).toBe("soon");
    expect(formatDate("2026-9-3")).toBe("2026-9-3");
  });

  it("takes a day inside a month label's input too", () => {
    expect(formatMonth("2026-09-15")).toBe("Sep 2026");
  });
});
