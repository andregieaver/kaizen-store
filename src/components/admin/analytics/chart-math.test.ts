import { describe, expect, it } from "vitest";

import { areaPath, barPath, funnelSteps, linePath, linearScale, maxOf, nextSort, niceTicks, paceOf, rampStep, RAMP_STEPS, sharePct, sparseIndices, truncateLabel } from "./chart-math";

describe("niceTicks", () => {
  it("rounds to 1, 2 or 5 times a power of ten and covers the data", () => {
    const t = niceTicks(0, 9300);
    expect(t.ticks).toEqual([0, 2000, 4000, 6000, 8000, 10000]);
    expect(t.min).toBe(0);
    expect(t.max).toBe(10000);
    expect(t.step).toBe(2000);
    expect(niceTicks(0, 100).ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("includes zero by default and can leave it out", () => {
    expect(niceTicks(950, 1020).min).toBe(0);
    const t = niceTicks(950, 1020, { includeZero: false });
    expect(t.min).toBeGreaterThan(0);
    expect(t.min).toBeLessThanOrEqual(950);
    expect(t.max).toBeGreaterThanOrEqual(1020);
  });

  it("gives a usable axis for nothing, all zero, and non-numbers", () => {
    expect(niceTicks(0, 0).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(0, 0, { integer: true }).ticks).toEqual([0, 1]);
    expect(niceTicks(NaN, Infinity).ticks.length).toBeGreaterThan(1);
    expect(niceTicks(Number.NaN, Number.NaN).min).toBe(0);
  });

  it("handles a single value away from zero", () => {
    const t = niceTicks(500, 500, { includeZero: false });
    expect(t.min).toBeLessThan(500);
    expect(t.max).toBeGreaterThan(500);
    expect(niceTicks(500, 500).ticks[0]).toBe(0);
  });

  it("handles negatives and a span that crosses zero", () => {
    const t = niceTicks(-300, 1200);
    expect(t.min).toBeLessThanOrEqual(-300);
    expect(t.max).toBeGreaterThanOrEqual(1200);
    expect(t.ticks).toContain(0);
    const down = niceTicks(-900, -100);
    expect(down.max).toBe(0);
    expect(down.min).toBeLessThanOrEqual(-900);
  });

  it("accepts the ends the wrong way round", () => {
    expect(niceTicks(10, 0)).toEqual(niceTicks(0, 10));
  });

  it("never puts a fraction on a count's axis with integer", () => {
    const t = niceTicks(0, 3, { integer: true });
    expect(t.ticks).toEqual([0, 1, 2, 3]);
    for (const tick of niceTicks(0, 7, { integer: true }).ticks) expect(Number.isInteger(tick)).toBe(true);
  });

  it("has no floating-point dust and stays short", () => {
    const t = niceTicks(0, 0.7);
    for (const tick of t.ticks) expect(String(tick).length).toBeLessThan(6);
    expect(niceTicks(0, 1e12).ticks.length).toBeLessThan(12);
    expect(niceTicks(0, 1000, { target: 3 }).ticks.length).toBeLessThanOrEqual(4);
  });
});

describe("linearScale", () => {
  it("maps a domain to a range, also reversed (an SVG's y)", () => {
    const y = linearScale([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(50)).toBe(100);
    expect(y(150)).toBe(-100);
  });

  it("maps an empty domain to the middle", () => {
    expect(linearScale([5, 5], [0, 100])(5)).toBe(50);
  });
});

describe("linePath", () => {
  it("joins points", () => {
    expect(linePath([{ x: 0, y: 10 }, { x: 10, y: 20.04 }])).toBe("M0 10L10 20");
  });

  it("lifts the pen at a gap", () => {
    expect(linePath([{ x: 0, y: 0 }, null, { x: 10, y: 5 }, { x: 20, y: 6 }])).toBe("M0 0 M10 5L20 6");
  });

  it("is empty for nothing and for only gaps, and skips non-finite points", () => {
    expect(linePath([])).toBe("");
    expect(linePath([null, null])).toBe("");
    expect(linePath([{ x: NaN, y: 1 }, { x: 1, y: 2 }])).toBe("M1 2");
  });

  it("is a bare move for one point", () => {
    expect(linePath([{ x: 3, y: 4 }])).toBe("M3 4");
  });
});

describe("areaPath", () => {
  it("closes each unbroken run down to the baseline", () => {
    const d = areaPath([{ x: 0, y: 5 }, { x: 10, y: 3 }, null, { x: 20, y: 4 }, { x: 30, y: 2 }], 10);
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(d.startsWith("M0 10 L0 5 L10 3 L10 10 Z")).toBe(true);
  });

  it("draws nothing for a single point or none", () => {
    expect(areaPath([{ x: 0, y: 1 }], 10)).toBe("");
    expect(areaPath([], 10)).toBe("");
    expect(areaPath([null], 10)).toBe("");
  });
});

describe("barPath", () => {
  it("rounds the end and keeps the baseline square, up", () => {
    const d = barPath(10, 100, 40, 20, 4);
    expect(d.startsWith("M10 100V44Q10 40 14 40H26Q30 40 30 44V100Z")).toBe(true);
  });

  it("does the same downward for a negative value", () => {
    const d = barPath(10, 100, 160, 20, 4);
    expect(d).toBe("M10 100V156Q10 160 14 160H26Q30 160 30 156V100Z");
  });

  it("shrinks the radius to fit a thin or short column", () => {
    expect(barPath(0, 100, 98, 20, 4)).toContain("Q0 98 2 98");
    expect(barPath(0, 100, 0, 6, 4)).toContain("Q0 0 3 0");
  });

  it("can be square", () => {
    expect(barPath(0, 10, 0, 5, 0)).toBe("M0 10V0H5V10Z");
  });

  it("is empty for no height, no width and bad numbers", () => {
    expect(barPath(0, 10, 10, 5)).toBe("");
    expect(barPath(0, 10, 0, 0)).toBe("");
    expect(barPath(NaN, 10, 0, 5)).toBe("");
  });
});

describe("sparseIndices", () => {
  it("keeps all when they fit", () => {
    expect(sparseIndices(3, 5)).toEqual([0, 1, 2]);
    expect(sparseIndices(0, 5)).toEqual([]);
    expect(sparseIndices(1, 5)).toEqual([0]);
  });

  it("spreads evenly and includes the first and the last", () => {
    const out = sparseIndices(30, 5);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(29);
    expect([...out].sort((a, b) => a - b)).toEqual(out);
  });

  it("copes with a maximum of one or less", () => {
    expect(sparseIndices(10, 1)).toEqual([0]);
    expect(sparseIndices(10, 0)).toEqual([0]);
  });

  it("never repeats an index", () => {
    const out = sparseIndices(6, 5);
    expect(new Set(out).size).toBe(out.length);
  });
});

describe("truncateLabel", () => {
  it("leaves a short label and cuts a long one with an ellipsis within the limit", () => {
    expect(truncateLabel("Shoes", 10)).toBe("Shoes");
    const cut = truncateLabel("A very long product name indeed", 12);
    expect(Array.from(cut).length).toBeLessThanOrEqual(12);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("counts characters, not code units, and survives a tiny limit", () => {
    expect(truncateLabel("😀😀😀😀", 3)).toBe("😀😀…");
    expect(truncateLabel("abc", 0)).toBe("…");
  });
});

describe("rampStep", () => {
  it("is 0 for nothing, negatives, missing and no maximum", () => {
    expect(rampStep(0, 10)).toBe(0);
    expect(rampStep(-4, 10)).toBe(0);
    expect(rampStep(null, 10)).toBe(0);
    expect(rampStep(undefined, 10)).toBe(0);
    expect(rampStep(5, 0)).toBe(0);
    expect(rampStep(5, null)).toBe(0);
    expect(rampStep(NaN, 10)).toBe(0);
  });

  it("tells any real value from none, and reaches the top at the maximum", () => {
    expect(rampStep(0.001, 1000)).toBe(1);
    expect(rampStep(1000, 1000)).toBe(RAMP_STEPS - 1);
    expect(rampStep(5000, 1000)).toBe(RAMP_STEPS - 1);
  });

  it("never goes down as the value goes up", () => {
    let last = 0;
    for (let v = 0; v <= 100; v += 1) {
      const step = rampStep(v, 100);
      expect(step).toBeGreaterThanOrEqual(last);
      expect(step).toBeLessThan(RAMP_STEPS);
      last = step;
    }
  });
});

describe("maxOf", () => {
  it("is the largest positive finite value, else 0", () => {
    expect(maxOf([1, null, 7, undefined, 3, NaN])).toBe(7);
    expect(maxOf([])).toBe(0);
    expect(maxOf([-5, -1])).toBe(0);
  });
});

describe("funnelSteps", () => {
  it("widths follow the widest stage and conversion follows the stage before", () => {
    const [a, b, c] = funnelSteps([1000, 400, 100]);
    expect(a).toEqual({ widthPct: 100, conversion: null, overall: 1 });
    expect(b.widthPct).toBe(40);
    expect(b.conversion).toBe(0.4);
    expect(c.conversion).toBe(0.25);
    expect(c.overall).toBe(0.1);
  });

  it("does not divide by zero and keeps an empty first stage honest", () => {
    const steps = funnelSteps([0, 0, 0]);
    expect(steps.map((s) => s.widthPct)).toEqual([0, 0, 0]);
    expect(steps.map((s) => s.conversion)).toEqual([null, null, null]);
    expect(steps.map((s) => s.overall)).toEqual([null, null, null]);
  });

  it("treats an unknown stage as unknown, never zero, and does not convert across it", () => {
    const [a, b, c] = funnelSteps([500, null, 20]);
    expect(a.widthPct).toBe(100);
    expect(b).toEqual({ widthPct: null, conversion: null, overall: null });
    expect(c.conversion).toBeNull();
    expect(c.overall).toBe(0.04);
  });

  it("measures overall from the first known stage when the first is unknown", () => {
    const [a, b, c] = funnelSteps([null, 200, 50]);
    expect(a.widthPct).toBeNull();
    expect(b.overall).toBe(1);
    expect(c.overall).toBe(0.25);
    expect(b.conversion).toBeNull();
  });

  it("caps a stage that passes the one before at the full width but reports the conversion as it is", () => {
    const [a, b] = funnelSteps([100, 150]);
    expect(a.widthPct).toBeCloseTo(66.67, 1);
    expect(b.widthPct).toBe(100);
    expect(b.conversion).toBe(1.5);
  });

  it("is empty for no stages and tiny volumes still draw", () => {
    expect(funnelSteps([])).toEqual([]);
    expect(funnelSteps([1, 1])[1].widthPct).toBe(100);
  });
});

describe("paceOf", () => {
  it("compares progress with what is expected by today", () => {
    expect(paceOf(600, 500, 1000)).toBe("ahead");
    expect(paceOf(400, 500, 1000)).toBe("behind");
    expect(paceOf(505, 500, 1000)).toBe("on");
    expect(paceOf(520, 500, 1000)).toBe("on");
    expect(paceOf(521, 500, 1000)).toBe("ahead");
  });

  it("is unknown without a target or a figure", () => {
    expect(paceOf(1, 1, 0)).toBe("unknown");
    expect(paceOf(1, 1, null)).toBe("unknown");
    expect(paceOf(null, 1, 10)).toBe("unknown");
    expect(paceOf(1, undefined, 10)).toBe("unknown");
  });

  it("handles nothing earned yet and a target already passed", () => {
    expect(paceOf(0, 500, 1000)).toBe("behind");
    expect(paceOf(2000, 1000, 1000)).toBe("ahead");
  });
});

describe("sharePct", () => {
  it("is a width between 0 and 100", () => {
    expect(sharePct(25, 100)).toBe(25);
    expect(sharePct(250, 100)).toBe(100);
    expect(sharePct(-5, 100)).toBe(0);
    expect(sharePct(5, 0)).toBe(0);
    expect(sharePct(null, 10)).toBe(0);
    expect(sharePct(5, NaN)).toBe(0);
  });
});

describe("nextSort", () => {
  it("flips the column that is sorted and starts another in its first direction", () => {
    expect(nextSort({ key: "revenue", dir: "desc" }, "revenue")).toBe("asc");
    expect(nextSort({ key: "revenue", dir: "asc" }, "revenue")).toBe("desc");
    expect(nextSort({ key: "revenue", dir: "asc" }, "name")).toBe("desc");
    expect(nextSort({ key: "revenue", dir: "desc" }, "name", "asc")).toBe("asc");
    expect(nextSort(null, "name", "asc")).toBe("asc");
    expect(nextSort(undefined, "name")).toBe("desc");
  });
});
