import { describe, expect, it } from "vitest";

import { buildVerdict, ceilingKb, machineKb, median } from "../../scripts/lib/build-stats.mjs";

const tenAt = (kb: number) => Array.from({ length: 10 }, () => kb);

describe("median", () => {
  it("is the middle number, the mean of the middle two, or null", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("machineKb", () => {
  const meminfo = "MemTotal:        8388608 kB\nMemFree: 1 kB\n";
  it("is the smaller of MemTotal and the cgroup's limit", () => {
    expect(machineKb(meminfo, "4294967296")).toBe(4194304);
    expect(machineKb(meminfo, "max")).toBe(8388608);
    expect(machineKb(meminfo, null)).toBe(8388608);
    expect(machineKb("", null)).toBe(0);
  });
});

describe("ceilingKb", () => {
  it("is the median of the last ten plus 10%, never above 75% of the machine", () => {
    expect(ceilingKb({ machineKb: 8388608, history: tenAt(5000000) })).toBeCloseTo(5500000, 0);
    expect(ceilingKb({ machineKb: 8388608, history: tenAt(7000000) })).toBe(6291456);
    expect(ceilingKb({ machineKb: 8388608, history: [5000000, 5000000, 5000000] })).toBe(6291456);
  });
});

describe("buildVerdict", () => {
  const base = { machineKb: 8388608, history: tenAt(5000000), seconds: 263 };
  it("a build 12% above the median is over though under 75%", () => {
    const verdict = buildVerdict({ ...base, peakKb: 5600000 });
    expect(verdict.over).toBe(true);
    expect(verdict.line).toContain("ceiling 5.2 GB");
  });
  it("a build 5% above the median is not over", () => {
    expect(buildVerdict({ ...base, peakKb: 5250000 }).over).toBe(false);
  });
  it("a build above 75% of the machine is over whatever the median", () => {
    expect(buildVerdict({ machineKb: 8388608, history: tenAt(6500000), peakKb: 6400000 }).over).toBe(true);
  });
  it("reads like a sentence", () => {
    expect(buildVerdict({ ...base, peakKb: 5662310 }).line).toBe(
      "Build: 263 s, peak 5.4 GB of 8.0 GB; ceiling 5.2 GB (median of the last 10 builds plus 10%, never above 75% of the machine)",
    );
  });
});
