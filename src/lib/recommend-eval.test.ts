import { describe, expect, it } from "vitest";

import { compareArms, compareShares, normalCdf, rankOf, summariseRanks } from "./recommend-eval";

describe("the check against past orders", () => {
  it("finds a product's place in a list", () => {
    expect(rankOf(["a", "b", "c"], "c")).toBe(3);
    expect(rankOf(["a"], "z")).toBeNull();
  });

  it("sums up hits at three cutoffs and the mean reciprocal rank", () => {
    const summary = summariseRanks([1, 2, null, 5, 12]);
    expect(summary.evaluated).toBe(5);
    expect(summary.hit).toEqual({ 1: 20, 4: 40, 12: 80 });
    // (1 + 1/2 + 0 + 1/5 + 1/12) / 5
    expect(summary.mrr).toBe(35.7);
    expect(summariseRanks([])).toEqual({ evaluated: 0, hit: { 1: null, 4: null, 12: null }, mrr: null });
  });
});

describe("comparing two rankings on what visitors did", () => {
  it("knows the normal distribution", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("says too few until both rankings have a hundred visitors", () => {
    expect(compareShares({ success: 10, n: 99 }, { success: 5, n: 100 }).verdict).toBe("too_few");
    expect(compareShares({ success: 0, n: 0 }, { success: 5, n: 100 })).toMatchObject({ verdict: "too_few", a: null, diff: null });
  });

  it("calls a difference clear only when it is beyond chance", () => {
    // 15 % against 8 % of 400 each: clear.
    const clear = compareShares({ success: 60, n: 400 }, { success: 32, n: 400 });
    expect(clear).toMatchObject({ a: 15, b: 8, diff: 7, verdict: "a_better" });
    expect(clear.p).toBeLessThan(0.05);
    // 10 % against 9 % of 400 each: not.
    expect(compareShares({ success: 40, n: 400 }, { success: 36, n: 400 }).verdict).toBe("no_clear_difference");
    // The other way round.
    expect(compareShares({ success: 32, n: 400 }, { success: 60, n: 400 }).verdict).toBe("b_better");
    // Nobody did anything in either: no difference, no p-value.
    expect(compareShares({ success: 0, n: 200 }, { success: 0, n: 200 })).toMatchObject({ verdict: "no_clear_difference", p: null });
  });

  it("puts the two measures into one plain sentence with what to do", () => {
    const ai = { visitors: 400, clickers: 60, adders: 30 };
    const plain = { visitors: 400, clickers: 32, adders: 14 };
    expect(compareArms(ai, plain).words).toContain("doing clearly better");
    expect(compareArms(plain, ai).words).toContain("consider switching the AI off");
    expect(compareArms({ visitors: 400, clickers: 40, adders: 20 }, { visitors: 400, clickers: 38, adders: 19 }).words).toContain("No clear difference");
    expect(compareArms({ visitors: 20, clickers: 4, adders: 1 }, plain).words).toContain("Too few visitors");
  });
});
