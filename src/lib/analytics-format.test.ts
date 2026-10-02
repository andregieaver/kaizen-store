import { describe, expect, it } from "vitest";

import { NO_FIGURE } from "./analytics-core";
import { formatAmount, formatDecimal, formatTimes, formatUpTo } from "./analytics-format";

describe("formatDecimal", () => {
  it("writes a fixed number of decimals with a point, rounding half away from zero", () => {
    expect(formatDecimal(1.44)).toBe("1.4");
    expect(formatDecimal(1.45)).toBe("1.5");
    expect(formatDecimal(-1.45)).toBe("−1.5");
    expect(formatDecimal(2, 2)).toBe("2.00");
    expect(formatDecimal(12345.67)).toBe("12\u00a0345.7");
  });
  it("never writes -0 and has no figure for what is not a number", () => {
    expect(formatDecimal(-0.04)).toBe("0.0");
    for (const bad of [null, undefined, NaN, Infinity]) expect(formatDecimal(bad)).toBe(NO_FIGURE);
  });
});

describe("formatUpTo", () => {
  it("drops zeros that carry nothing", () => {
    expect(formatUpTo(0.4285714)).toBe("0.43");
    expect(formatUpTo(2)).toBe("2");
    expect(formatUpTo(1.5)).toBe("1.5");
    expect(formatUpTo(-0.001)).toBe("0");
    for (const bad of [null, undefined, NaN]) expect(formatUpTo(bad)).toBe(NO_FIGURE);
  });
});

describe("formatTimes", () => {
  it("writes a multiple with one decimal", () => {
    expect(formatTimes(3.24)).toBe("3.2×");
    expect(formatTimes(0)).toBe("0.0×");
    expect(formatTimes(null)).toBe(NO_FIGURE);
    expect(formatTimes(Number.NaN)).toBe(NO_FIGURE);
  });
});

describe("formatAmount", () => {
  it("writes a negative amount with the proper minus whichever sign the locale's Intl uses", () => {
    expect(formatAmount(-150_000, "NOK", "en")).toContain("\u2212");
    expect(formatAmount(-150_000, "NOK", "en")).not.toContain("-");
    expect(formatAmount(-150_000, "NOK", "nb-NO")).toContain("\u2212");
    expect(formatAmount(-150_000, "EUR", "de-DE")).toContain("\u2212");
    expect(formatAmount(-150_000, "EUR", "de-DE")).not.toContain("-");
    expect(formatAmount(-150_000, "SEK", "sv-SE")).not.toContain("-");
  });

  it("is the market's own writing for a positive amount", () => {
    expect(formatAmount(123_456, "NOK", "en")).toMatch(/1,234\.56/);
    expect(formatAmount(0, "NOK", "en")).toMatch(/0\.00/);
  });
});
