import { describe, expect, it } from "vitest";

import { effectiveFeeBps, formatBps, isOnPlan, percentToBps } from "./plans";

describe("effectiveFeeBps", () => {
  const base = { overrideBps: null, planFeeBps: 150, status: "active", defaultBps: 300 };

  it("uses the plan's fee while the store is on its plan", () => {
    expect(effectiveFeeBps(base)).toBe(150);
    expect(effectiveFeeBps({ ...base, status: "trialing" })).toBe(150);
    expect(effectiveFeeBps({ ...base, status: "past_due" })).toBe(150);
  });

  it("falls back to the platform default without a plan or after cancelling", () => {
    expect(effectiveFeeBps({ ...base, status: "canceled" })).toBe(300);
    expect(effectiveFeeBps({ ...base, planFeeBps: null, status: null })).toBe(300);
  });

  it("lets a store's own fee win over both, including a zero fee", () => {
    expect(effectiveFeeBps({ ...base, overrideBps: 0 })).toBe(0);
    expect(effectiveFeeBps({ ...base, overrideBps: 90, status: "canceled" })).toBe(90);
  });
});

describe("percentToBps", () => {
  it("reads percentages with a point or a comma", () => {
    expect(percentToBps("1.5")).toBe(150);
    expect(percentToBps("1,25 %")).toBe(125);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("20")).toBe(2000);
  });

  it("refuses anything that is not a percentage up to 20", () => {
    expect(percentToBps("")).toBeNull();
    expect(percentToBps("21")).toBeNull();
    expect(percentToBps("-1")).toBeNull();
    expect(percentToBps("1.234")).toBeNull();
    expect(percentToBps("abc")).toBeNull();
  });
});

describe("formatting", () => {
  it("shows basis points as a percentage", () => {
    expect(formatBps(150)).toBe("1.5 %");
    expect(formatBps(0)).toBe("0 %");
  });

  it("knows which statuses mean the store is on its plan", () => {
    expect(isOnPlan("active")).toBe(true);
    expect(isOnPlan("canceled")).toBe(false);
    expect(isOnPlan(null)).toBe(false);
  });
});
