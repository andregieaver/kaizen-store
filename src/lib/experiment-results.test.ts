import { describe, expect, it } from "vitest";

import {
  compareToOriginal,
  estimateRuntime,
  harmedVersion,
  normalCdf,
  normalQuantile,
  splitCheckP,
  verdictOf,
  visitorsPerVersion,
  type VariantFigures,
} from "./experiment-results";

const fig = (key: string, visitors: number, conversions: number, money: VariantFigures["money"] = null): VariantFigures => ({ key, name: key.toUpperCase(), visitors, conversions, money });
const base = { goal: "orders" as const, splitP: 0.5, days: 14, minVisitors: 0, minDays: 14, currency: "NOK", locale: "nb-NO" };

describe("the arithmetic", () => {
  it("knows the normal distribution", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 4);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 8);
    expect(normalQuantile(0.9999)).toBeCloseTo(3.719, 2);
    expect(normalCdf(normalQuantile(0.3))).toBeCloseTo(0.3, 6);
  });

  it("checks the split of any number of versions against their shares", () => {
    expect(splitCheckP([500, 500], [0.5, 0.5])).toBeCloseTo(1, 6);
    expect(splitCheckP([520, 480], [0.5, 0.5])).toBeCloseTo(0.206, 2);
    expect(splitCheckP([600, 400], [0.5, 0.5])).toBeLessThan(0.0001);
    // Three versions: the same counts as shares of 1/3 each are fine, a lopsided one is not.
    expect(splitCheckP([335, 330, 335], [1 / 3, 1 / 3, 1 / 3])).toBeGreaterThan(0.9);
    expect(splitCheckP([500, 250, 250], [1 / 3, 1 / 3, 1 / 3])).toBeLessThan(0.0001);
    expect(splitCheckP([0, 0], [0.5, 0.5])).toBe(1);
    expect(splitCheckP([10], [1])).toBe(1);
  });

  it("compares a rate with the original: the difference, its interval and the chance the version is better", () => {
    const c = compareToOriginal("rate", fig("a", 5000, 100), fig("b", 5000, 140))!;
    expect(c.original).toBeCloseTo(0.02, 6);
    expect(c.version).toBeCloseTo(0.028, 6);
    expect(c.relative).toBeCloseTo(0.4, 6);
    expect(c.low).toBeGreaterThan(0);
    expect(c.chanceBetter).toBeGreaterThan(0.99);
    const even = compareToOriginal("rate", fig("a", 5000, 100), fig("b", 5000, 101))!;
    expect(even.low).toBeLessThan(0);
    expect(even.high).toBeGreaterThan(0);
    expect(even.chanceBetter).toBeGreaterThan(0.4);
    expect(even.chanceBetter).toBeLessThan(0.6);
    expect(compareToOriginal("rate", fig("a", 0, 0), fig("b", 10, 1))).toBeNull();
  });

  it("compares revenue per visitor, with every visitor counted", () => {
    // 1,000 visitors each: the original earns 10 a visitor, the version 12; both have a spread of about 30.
    const money = (mean: number) => ({ sum: mean * 1000, sumSq: (900 + mean * mean) * 999 + 1000 * mean * mean * 0 + mean * mean });
    const c = compareToOriginal("money", fig("a", 1000, 0, money(10)), fig("b", 1000, 0, money(12)))!;
    expect(c.diff).toBeCloseTo(2, 6);
    expect(c.relative).toBeCloseTo(0.2, 6);
    expect(c.high).toBeGreaterThan(c.low);
    expect(compareToOriginal("money", fig("a", 10, 0), fig("b", 10, 0))).toBeNull();
  });

  it("works out how many visitors a change needs, and how long that takes", () => {
    // The usual figure: 2 % baseline, a 10 % change needs about 80,000 a version.
    expect(visitorsPerVersion(0.02, 0.1)).toBeGreaterThan(75_000);
    expect(visitorsPerVersion(0.02, 0.1)).toBeLessThan(86_000);
    expect(visitorsPerVersion(0.2, 0.2)!).toBeLessThan(3000);
    expect(visitorsPerVersion(0, 0.1)).toBeNull();
    expect(visitorsPerVersion(0.1, 0)).toBeNull();
    const quick = estimateRuntime({ baseline: 0.2, relativeChange: 0.2, versions: 2, eligiblePerDay: 1000, trafficShare: 1 })!;
    expect(quick.days).toBe(14);
    expect(quick.tooLong).toBe(false);
    expect(quick.sentence).toMatch(/about 14 days/);
    const slow = estimateRuntime({ baseline: 0.02, relativeChange: 0.1, versions: 2, eligiblePerDay: 1000, trafficShare: 1 })!;
    expect(slow.days % 7).toBe(0);
    expect(slow.days).toBeGreaterThan(90);
    expect(slow.sentence).toMatch(/more than 90 days/);
    const medium = estimateRuntime({ baseline: 0.05, relativeChange: 0.2, versions: 2, eligiblePerDay: 300, trafficShare: 1 })!;
    expect(medium.tooLong).toBe(true);
    expect(medium.sentence).toMatch(/That is long/);
    expect(estimateRuntime({ baseline: 0.02, relativeChange: 0.1, versions: 2, eligiblePerDay: 0, trafficShare: 1 })).toBeNull();
  });
});

describe("what the results say", () => {
  it("says nothing but 'too early' before the minimum, with what to wait for", () => {
    const few = verdictOf({ ...base, figures: [fig("a", 120, 4), fig("b", 130, 9)] });
    expect(few.kind).toBe("few");
    expect(few.headline).toBe("Too early to say.");
    expect(few.detail).toMatch(/Wait for 80 more visitors/);
    const early = verdictOf({ ...base, days: 5, figures: [fig("a", 4000, 80), fig("b", 4000, 120)] });
    expect(early.kind).toBe("early");
    expect(early.detail).toMatch(/Wait for 9 more days/);
    expect(early.best).toBeNull();
  });

  it("names a better version once the minimum is reached, in the words the doc promises", () => {
    const v = verdictOf({ ...base, figures: [fig("a", 4000, 80), fig("b", 4000, 130)] });
    expect(v.kind).toBe("better");
    expect(v.best).toBe("b");
    expect(v.headline).toBe("B is better than the original.");
    expect(v.detail).toMatch(/B got 63 % more visitors who placed an order than the original \(2 % to 3\.25 %\)/);
    expect(v.detail).toMatch(/We are (more than 99|9\d) % sure B is better/);
    expect(v.detail).toMatch(/8,000 visitors who accepted statistics cookies, over 14 days/);
  });

  it("says when the original is better, or when there is no clear difference", () => {
    const worse = verdictOf({ ...base, figures: [fig("a", 4000, 130), fig("b", 4000, 70)] });
    expect(worse.kind).toBe("worse");
    expect(worse.detail).toMatch(/Keep the original/);
    const even = verdictOf({ ...base, figures: [fig("a", 4000, 100), fig("b", 4000, 104)] });
    expect(even.kind).toBe("even");
    expect(even.headline).toBe("No clear difference between the versions.");
  });

  it("puts a broken split before everything", () => {
    const v = verdictOf({ ...base, splitP: 0.00001, figures: [fig("a", 4000, 80), fig("b", 4000, 130)] });
    expect(v.kind).toBe("broken");
    expect(v.headline).toMatch(/cannot be trusted/);
  });

  it("holds a lucky version to a stricter standard when there are several", () => {
    // B alone would pass at 95 %, but against three versions its interval is wider.
    const figures = [fig("a", 3000, 90), fig("b", 3000, 124), fig("c", 3000, 92), fig("d", 3000, 88)];
    const one = verdictOf({ ...base, figures: figures.slice(0, 2) });
    const three = verdictOf({ ...base, figures });
    expect(one.kind).toBe("better");
    expect(three.kind).toBe("even");
  });

  it("reads revenue per visitor in the store's money", () => {
    const money = (mean: number, n: number) => ({ sum: mean * n, sumSq: (900 + mean * mean) * n });
    const v = verdictOf({ ...base, goal: "revenue", figures: [{ ...fig("a", 3000, 0), money: money(10_000, 3000) }, { ...fig("b", 3000, 0), money: money(12_000, 3000) }] });
    expect(v.kind).toBe("better");
    expect(v.detail).toMatch(/B earned 20 % more per visitor than the original/);
    expect(v.detail).toMatch(/kr|NOK/);
  });

  it("trips the guardrail only for clear harm to orders with plenty of visitors", () => {
    const f = [fig("a", 5000, 0), fig("b", 5000, 0)];
    expect(harmedVersion(f, { a: 250, b: 150 })).toBe("b");
    expect(harmedVersion(f, { a: 250, b: 240 })).toBeNull();
    expect(harmedVersion([fig("a", 500, 0), fig("b", 500, 0)], { a: 50, b: 5 })).toBeNull();
    expect(harmedVersion([fig("b", 5000, 0)], { b: 1 })).toBeNull();
  });
});
