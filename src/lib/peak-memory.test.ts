import { describe, expect, it } from "vitest";

import { formatGb, readCgroupPeak, usedFromMeminfo } from "../../scripts/lib/peak-memory.mjs";

describe("the build's peak-memory readers (bloat review step 1.20)", () => {
  it("reads the cgroup's peak, a number and a newline", () => {
    expect(readCgroupPeak("7730941132\n")).toBe(7730941132);
  });

  it("refuses an empty or garbled peak", () => {
    expect(readCgroupPeak("")).toBeNull();
    expect(readCgroupPeak("max\n")).toBeNull();
    expect(readCgroupPeak("12 abc")).toBeNull();
  });

  it("works used memory out of /proc/meminfo as total minus available, in bytes", () => {
    const text = "MemTotal:        8000000 kB\nMemFree:          100000 kB\nMemAvailable:    1500000 kB\n";
    expect(usedFromMeminfo(text)).toBe(6_656_000_000);
  });

  it("gives null when a line is missing", () => {
    expect(usedFromMeminfo("MemTotal:        8000000 kB\nMemFree: 100000 kB\n")).toBeNull();
    expect(usedFromMeminfo("")).toBeNull();
  });

  it("writes gigabytes with one decimal", () => {
    expect(formatGb(7730941132)).toBe("7.2 GB");
  });
});
