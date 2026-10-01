import { describe, expect, it } from "vitest";

import { BROKEN_SPLIT_P, callRates, sayCall, splitP, UNITS } from "./experiment-units";

const search = { rule: "interval", floor: UNITS.search.floor } as const;

describe("callRates, the interval rule (the search test, D77)", () => {
  it("gives the difference in rates with a 95 % interval", () => {
    const c = callRates({ hits: 300, of: 1000 }, { hits: 360, of: 1000 }, search);
    expect(c.diff).toBeCloseTo(0.06, 6);
    // se = sqrt(.3*.7/1000 + .36*.64/1000) = sqrt(0.0004404) = 0.020986
    expect(c.low).toBeCloseTo(0.06 - 1.96 * 0.020986, 4);
    expect(c.high).toBeCloseTo(0.06 + 1.96 * 0.020986, 4);
    expect(c.control).toBeCloseTo(0.3, 9);
    expect(c.treatment).toBeCloseTo(0.36, 9);
    expect(callRates({ hits: 0, of: 0 }, { hits: 1, of: 2 }, search)).toMatchObject({ call: "few", diff: null, low: null, control: null });
  });

  it("decides only with enough units and a trustworthy split, by the rule fixed in advance", () => {
    const keyword = { hits: 300, of: 1000 };
    expect(callRates(keyword, { hits: 360, of: 1000 }, { ...search, splitChance: 0.5 }).call).toBe("better");
    expect(callRates(keyword, { hits: 240, of: 1000 }, { ...search, splitChance: 0.5 }).call).toBe("worse");
    expect(callRates(keyword, { hits: 310, of: 1000 }, { ...search, splitChance: 0.5 }).call).toBe("even");
    expect(callRates({ hits: 30, of: search.floor - 1 }, { hits: 60, of: 1000 }, search).call).toBe("few");
    expect(callRates(keyword, { hits: 360, of: 1000 }, { ...search, splitChance: BROKEN_SPLIT_P / 10 }).call).toBe("broken");
    // Fewer searches finding nothing is better: the call flips, the numbers do not.
    const lower = callRates({ hits: 200, of: 1000 }, { hits: 120, of: 1000 }, { ...search, lowerIsBetter: true });
    expect(lower.call).toBe("better");
    expect(lower.diff).toBeCloseTo(-0.08, 9);
  });
});

describe("callRates, the pooled rule (the recommendations test, D140)", () => {
  const tab = { rule: "pooled", floor: UNITS.tab.floor } as const;

  it("calls a clear difference with its p-value, and none without enough tabs", () => {
    const clear = callRates({ hits: 32, of: 400 }, { hits: 60, of: 400 }, tab);
    expect(clear.call).toBe("better");
    expect(clear.p).toBeLessThan(0.01);
    expect(clear.low).toBeNull();
    expect(callRates({ hits: 36, of: 400 }, { hits: 40, of: 400 }, tab).call).toBe("even");
    expect(callRates({ hits: 5, of: 99 }, { hits: 10, of: 400 }, tab).call).toBe("few");
    // Nobody in either: no spread to judge by.
    expect(callRates({ hits: 0, of: 200 }, { hits: 0, of: 200 }, tab)).toMatchObject({ call: "even", p: null });
  });
});

describe("splitP", () => {
  it("flags a split that the assignment cannot explain", () => {
    expect(splitP(500, 500, 0.5)).toBeCloseTo(1, 6);
    // 520/480 is ordinary noise; 600/400 is not.
    expect(splitP(520, 480, 0.5)).toBeGreaterThan(0.2);
    expect(splitP(600, 400, 0.5)).toBeLessThan(0.001);
    // Checked against the share asked for, not an even split.
    expect(splitP(200, 800, 0.2)).toBeCloseTo(1, 6);
    expect(splitP(0, 0, 0.5)).toBe(1);
  });
});

describe("sayCall", () => {
  const control = { hits: 300, of: 1000 };
  const treatment = { hits: 360, of: 1000 };
  const say = (unit: "search" | "tab", c = control, t = treatment, floor?: number) => {
    const rule = unit === "search" ? "interval" : "pooled";
    const call = callRates(c, t, { rule, floor: floor ?? UNITS[unit].floor });
    return sayCall({ unit, call, control: c, treatment: t, controlName: "Keyword", treatmentName: "Hybrid", measure: "opened a result" });
  };

  it("says which is better, in the unit's words, from what was counted", () => {
    const said = say("search");
    expect(said.headline).toBe("Hybrid is better than Keyword.");
    expect(said.detail).toContain("Hybrid: 36 % of searches opened a result; Keyword: 30 %.");
    expect(said.detail).toContain("1,000 searches for Keyword and 1,000 for Hybrid");
    expect(say("tab").detail).toContain("tabs");
  });

  it("says the original is better, no clear difference, too early and a broken split", () => {
    expect(say("search", treatment, control).headline).toBe("Keyword is better than Hybrid.");
    expect(say("search", control, { hits: 305, of: 1000 }).headline).toBe("No clear difference between Keyword and Hybrid.");
    const early = say("search", { hits: 3, of: 40 }, { hits: 6, of: 50 });
    expect(early.headline).toBe("Too early to say.");
    expect(early.detail).toContain("Wait for at least 200 searches in each.");
    const broken = sayCall({
      unit: "search",
      call: callRates(control, treatment, { ...search, splitChance: 0 }),
      control,
      treatment,
      controlName: "Keyword",
      treatmentName: "Hybrid",
      measure: "opened a result",
    });
    expect(broken.headline).toContain("how searches are divided");
  });

  it("does not say why, or promise anything", () => {
    for (const said of [say("search"), say("tab"), say("search", treatment, control)]) expect(`${said.headline} ${said.detail}`).not.toMatch(/because|will |guarantee/i);
  });
});
