import { describe, expect, it } from "vitest";

import { cleanEnd, timeLeft } from "./countdown";
import { countAt, easeOut, statText } from "./stats-count";

describe("the countdown (D544)", () => {
  const end = "2026-11-29T22:59:00.000Z";

  it("says what is left in whole days, hours, minutes and seconds", () => {
    expect(timeLeft(end, Date.parse("2026-11-27T21:57:58.500Z"))).toEqual({ days: 2, hours: 1, minutes: 1, seconds: 1 });
  });

  it("is gone at zero and after, and without an end", () => {
    expect(timeLeft(end, Date.parse(end))).toBeNull();
    expect(timeLeft(end, Date.parse(end) + 1)).toBeNull();
    expect(timeLeft(null, 0)).toBeNull();
    expect(timeLeft("not a date", 0)).toBeNull();
  });

  it("keeps an end as a moment in UTC", () => {
    expect(cleanEnd("2026-11-29T23:59:00+01:00")).toBe(end);
    expect(cleanEnd("")).toBeNull();
  });
});

describe("animated stats (D544)", () => {
  it("counts up easing out and rests on the figure as typed", () => {
    expect(countAt(12_000, 0, 0, 2000)).toBe(0);
    expect(countAt(12_000, 0, 1000, 2000)).toBe(10_500);
    expect(countAt(4.9, 1, 2000, 2000)).toBe(4.9);
    expect(countAt(4.9, 1, 5000, 2000)).toBe(4.9);
    expect(easeOut(2)).toBe(1);
  });

  it("writes the figure as the page's language does", () => {
    expect(statText(12000, 0, "en-GB")).toBe("12,000");
    expect(statText(4.9, 1, "nb-NO")).toBe("4,9");
  });
});
