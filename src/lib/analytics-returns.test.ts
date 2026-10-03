import { describe, expect, it } from "vitest";

import {
  MIN_PRODUCT_UNITS,
  MIN_RATE_ORDERS,
  MIN_REASON_SAMPLE,
  MIN_TIMING_SAMPLE,
  daysSince,
  formatDays,
  gatedRate,
  maturityNote,
  median,
  reasonBreakdown,
  timingOf,
} from "./analytics-returns";
import { RETURN_REASONS } from "./withdrawal";

describe("gatedRate", () => {
  it("is a number from the minimum volume up", () => {
    const at = gatedRate({ part: 3, whole: MIN_RATE_ORDERS, min: MIN_RATE_ORDERS, unit: "orders", tracked: true });
    expect(at.missing).toBeNull();
    expect(at.value).toBeCloseTo(0.1);
    const below = gatedRate({ part: 3, whole: MIN_RATE_ORDERS - 1, min: MIN_RATE_ORDERS, unit: "orders", tracked: true });
    expect(below.value).toBeNull();
    expect(below.missing).toContain(`Only ${MIN_RATE_ORDERS - 1} orders`);
    expect(below.missing).toContain(`at least ${MIN_RATE_ORDERS}`);
  });

  it("is a real zero only when there is volume and the store records returns", () => {
    expect(gatedRate({ part: 0, whole: 100, min: 30, unit: "orders", tracked: true })).toEqual({ value: 0, missing: null });
    const untracked = gatedRate({ part: 0, whole: 100, min: 30, unit: "orders", tracked: false });
    expect(untracked.value).toBeNull();
    expect(untracked.missing).toContain("No return has been recorded in Kaizen yet");
  });

  it("says when nothing was sold, and speaks of one unit in the singular", () => {
    expect(gatedRate({ part: 0, whole: 0, min: 30, unit: "units", tracked: true }).missing).toBe("No goods units were sold in this period.");
    expect(gatedRate({ part: 0, whole: 0, min: 30, unit: "orders", tracked: true }).missing).toBe("No goods orders were sold in this period.");
    expect(gatedRate({ part: 1, whole: 1, min: 30, unit: "units", tracked: true }).missing).toContain("Only 1 unit in this period");
    expect(gatedRate({ part: 1, whole: 1, min: 30, unit: "orders", tracked: true }).missing).toContain("Only 1 order in this period");
  });

  it("keeps the product minimum below the rate minimum", () => {
    expect(MIN_PRODUCT_UNITS).toBeLessThan(30);
    expect(gatedRate({ part: 2, whole: MIN_PRODUCT_UNITS, min: MIN_PRODUCT_UNITS, unit: "units", tracked: true }).value).toBeCloseTo(0.1);
  });
});

describe("median and times", () => {
  it("takes the middle, or the mean of the two middle ones, whatever the order", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([1, Number.NaN, 3])).toBe(2);
  });

  it("measures days between instants and never a negative time", () => {
    expect(daysSince(0, 86_400_000 * 2.5)).toBe(2.5);
    expect(daysSince(100, 50)).toBeNull();
    expect(daysSince(null, 50)).toBeNull();
    expect(daysSince(0, undefined)).toBeNull();
  });

  it("gives a typical time only from the minimum sample", () => {
    const few = timingOf([1, 2, 3, null], "a request date");
    expect(few.n).toBe(3);
    expect(few.medianDays).toBeNull();
    expect(few.missing).toContain("Only 3 returns");
    expect(few.missing).toContain(`at least ${MIN_TIMING_SAMPLE}`);
    const enough = timingOf([1, 2, 3, 4, 10], "a request date");
    expect(enough.medianDays).toBe(3);
    expect(enough.slowestDays).toBe(10);
    expect(enough.missing).toBeNull();
    const none = timingOf([null, null], "the goods received first");
    expect(none.n).toBe(0);
    expect(none.missing).toBe("No return was refunded in this period that has the goods received first.");
  });

  it("writes days plainly", () => {
    expect(formatDays(0.2)).toBe("under a day");
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(2.5)).toBe("2.5 days");
    expect(formatDays(3.04)).toBe("3 days");
    expect(formatDays(null)).toBe("–");
  });
});

describe("reasonBreakdown", () => {
  it("lists the named reasons by count and keeps 'no reason given' last and apart", () => {
    const b = reasonBreakdown([
      { reason: "too_small", returns: 4, units: 5 },
      { reason: "changed_mind", returns: 9, units: 10 },
      { reason: null, returns: 20, units: 22 },
      { reason: "defective", returns: 2, units: 2 },
    ]);
    expect(b.rows.map((r) => r.reason)).toEqual(["changed_mind", "too_small", "defective", ""]);
    expect(b.total).toBe(35);
    expect(b.given).toBe(15);
    expect(b.sharesShown).toBe(true);
    expect(b.rows[0].share).toBeCloseTo(9 / 15);
    expect(b.rows.at(-1)!.label).toBe("No reason given");
    expect(b.rows.at(-1)!.share).toBeNull();
    expect(b.note).toBe("15 of 35 returns have a reason; shares are of those. A withdrawal asks for none.");
  });

  it("shows counts only under the minimum sample", () => {
    const b = reasonBreakdown([{ reason: "too_big", returns: MIN_REASON_SAMPLE - 1, units: 3 }]);
    expect(b.sharesShown).toBe(false);
    expect(b.rows[0].share).toBeNull();
    expect(b.rows[0].returns).toBe(MIN_REASON_SAMPLE - 1);
    expect(b.note).toContain("shares need at least 10");
  });

  it("says plainly when no return has a reason, and nothing when there are no returns", () => {
    expect(reasonBreakdown([{ reason: null, returns: 3, units: 3 }]).note).toContain("None of the returns");
    const empty = reasonBreakdown([]);
    expect(empty.rows).toEqual([]);
    expect(empty.note).toBeNull();
  });

  it("counts a text that is not on the list as Other, and every listed reason has a label", () => {
    const b = reasonBreakdown([{ reason: "old free text", returns: 2, units: 2 }, { reason: "other", returns: 1, units: 1 }]);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]).toMatchObject({ reason: "other", label: "Other", returns: 3 });
    for (const reason of RETURN_REASONS) {
      expect(reasonBreakdown([{ reason, returns: 1, units: 1 }]).rows[0].label).not.toBe("");
    }
  });
});

describe("maturityNote", () => {
  it("warns while the period reaches into the return window and not after it", () => {
    // The period ends on 2026-09-30 (to = 10-01), the window is 14 days.
    const period = { to: "2026-10-01" };
    expect(maturityNote(period, "2026-10-02", 14)).toContain("last 14 days");
    expect(maturityNote(period, "2026-10-14", 14)).toContain("last 14 days");
    expect(maturityNote(period, "2026-10-15", 14)).toBeNull();
    expect(maturityNote(period, "2026-12-01", 14)).toBeNull();
  });

  it("follows the store's own longer window", () => {
    expect(maturityNote({ to: "2026-10-01" }, "2026-11-01", 60)).toContain("last 60 days");
    expect(maturityNote({ to: "2026-10-01" }, "2026-11-01", 14)).toBeNull();
  });

  it("warns for a period that has not ended", () => {
    expect(maturityNote({ to: "2026-10-04" }, "2026-10-02", 14)).not.toBeNull();
  });
});
