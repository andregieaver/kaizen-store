import { describe, expect, it } from "vitest";

import {
  buildCohorts,
  cohortTrend,
  COHORT_OFFSETS,
  ltvHistoric,
  ltvPredicted,
  newVsReturning,
  purchaseFrequency,
  quintileScores,
  repeatRates,
  rfm,
  segmentOf,
  segmentSummary,
  type CohortRow,
  type CohortTable,
  type CustomerAggregate,
  type OrderMonth,
  type RepeatCustomer,
} from "./analytics-customers";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-01T00:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

describe("newVsReturning", () => {
  const from = "2026-09-01T00:00:00Z";
  const to = "2026-10-01T00:00:00Z";
  const rows = [
    { key: "a", firstOrderAt: "2026-09-05T10:00:00Z", ordersInPeriod: 2, revenueMinor: 5000 },
    { key: "b", firstOrderAt: "2026-08-31T23:59:59Z", ordersInPeriod: 1, revenueMinor: 3000 },
    { key: "c", firstOrderAt: "2026-09-01T00:00:00Z", ordersInPeriod: 1, revenueMinor: 2000 },
    { key: "d", firstOrderAt: "2026-10-01T00:00:00Z", ordersInPeriod: 1, revenueMinor: 999 },
    { key: "e", firstOrderAt: "2026-01-01T00:00:00Z", ordersInPeriod: 0, revenueMinor: 0 },
    { key: "f", firstOrderAt: "garbage", ordersInPeriod: 1, revenueMinor: 777 },
    { key: "g", firstOrderAt: "2025-01-01T00:00:00Z", ordersInPeriod: 3, revenueMinor: 10_000 },
  ];

  it("splits by the date of the first order: the period's start is new, the day before is returning", () => {
    expect(newVsReturning(rows, from, to)).toEqual({
      newCustomers: 2,
      newOrders: 3,
      newRevenueMinor: 7000,
      returningCustomers: 2,
      returningOrders: 4,
      returningRevenueMinor: 13_000,
      returningShare: 0.5,
      returningRevenueShare: 0.65,
    });
  });

  it("leaves out customers with nothing in the period, a first order after it, or no usable date", () => {
    const only = newVsReturning(rows.filter((r) => ["d", "e", "f"].includes(r.key)), from, to);
    expect(only.newCustomers + only.returningCustomers).toBe(0);
    expect(only.returningShare).toBeNull();
    expect(only.returningRevenueShare).toBeNull();
  });

  it("is all zero with no customers or with a period that is not dates", () => {
    expect(newVsReturning([], from, to).returningShare).toBeNull();
    expect(newVsReturning(rows, "nope", to)).toMatchObject({ newCustomers: 0, returningCustomers: 0 });
  });

  it("takes Dates as well as strings", () => {
    expect(newVsReturning(rows, new Date(from), new Date(to)).newCustomers).toBe(2);
  });

  it("has a returning share of 1 when everyone is returning, and revenue share null when nothing was spent", () => {
    const r = newVsReturning([{ key: "x", firstOrderAt: "2020-01-01T00:00:00Z", ordersInPeriod: 1, revenueMinor: 0 }], from, to);
    expect(r.returningShare).toBe(1);
    expect(r.returningRevenueShare).toBeNull();
  });
});

describe("repeatRates", () => {
  const customers: RepeatCustomer[] = [
    { firstOrderAt: ago(11), secondOrderAt: null }, // too young for any window
    { firstOrderAt: ago(31), secondOrderAt: null }, // in 30 only, did not return
    { firstOrderAt: ago(61), secondOrderAt: ago(61 - 19) }, // 30: returned after 19 days
    { firstOrderAt: ago(122), secondOrderAt: ago(122 - 44) }, // 30 no, 90 yes
    { firstOrderAt: ago(395), secondOrderAt: ago(395 - 30) }, // exactly 30 days: counts in all four
    { firstOrderAt: ago(638), secondOrderAt: null },
    { firstOrderAt: ago(487), secondOrderAt: ago(487 + 30) }, // second before first: no second order
    { firstOrderAt: ago(214), secondOrderAt: ago(214 - 10) }, // 30, 90, 180
    { firstOrderAt: "garbage", secondOrderAt: ago(1) }, // not a customer
  ];
  const rates = repeatRates(customers, new Date(NOW));
  const at = (days: number) => rates.find((r) => r.days === days)!;

  it("only has customers old enough in the base", () => {
    expect([30, 90, 180, 365].map((d) => at(d).base)).toEqual([7, 5, 4, 3]);
  });

  it("counts a second order within the window, the last day included", () => {
    expect([30, 90, 180, 365].map((d) => at(d).repeaters)).toEqual([3, 3, 2, 1]);
    expect(at(30).rate).toBeCloseTo(3 / 7, 10);
    expect(at(90).rate).toBe(0.6);
    expect(at(180).rate).toBe(0.5);
    expect(at(365).rate).toBeCloseTo(1 / 3, 10);
  });

  it("returns the four windows in order", () => {
    expect(rates.map((r) => r.days)).toEqual([30, 90, 180, 365]);
  });

  it("a second order a millisecond late is not within the window", () => {
    const first = NOW - 100 * DAY;
    const late = repeatRates([{ firstOrderAt: new Date(first).toISOString(), secondOrderAt: new Date(first + 30 * DAY + 1).toISOString() }], new Date(NOW), [30]);
    expect(late[0]).toMatchObject({ base: 1, repeaters: 0 });
  });

  it("a customer exactly N days old is in the base", () => {
    expect(repeatRates([{ firstOrderAt: ago(30), secondOrderAt: null }], new Date(NOW), [30])[0].base).toBe(1);
    expect(repeatRates([{ firstOrderAt: new Date(NOW - 30 * DAY + 1).toISOString(), secondOrderAt: null }], new Date(NOW), [30])[0].base).toBe(0);
  });

  it("has no rate with an empty base, and takes custom windows", () => {
    expect(repeatRates([], new Date(NOW))[0]).toEqual({ days: 30, base: 0, repeaters: 0, rate: null });
    expect(repeatRates(customers, new Date(NOW), [7]).map((r) => r.days)).toEqual([7]);
    expect(repeatRates([{ firstOrderAt: ago(5), secondOrderAt: null }], new Date(NOW), [30])[0].rate).toBeNull();
  });

  it("is an empty base when now is not a date", () => {
    expect(repeatRates(customers, "nope").every((r) => r.base === 0 && r.rate === null)).toBe(true);
  });

  it("ignores a second order that is not a date", () => {
    expect(repeatRates([{ firstOrderAt: ago(100), secondOrderAt: "junk" }], new Date(NOW), [30])[0]).toMatchObject({ base: 1, repeaters: 0 });
  });
});

describe("purchaseFrequency", () => {
  it("is orders over customers", () => {
    expect(purchaseFrequency(30, 20)).toBe(1.5);
    expect(purchaseFrequency(0, 20)).toBe(0);
  });
  it("is null with no customers", () => {
    expect(purchaseFrequency(5, 0)).toBeNull();
  });
});

describe("ltvHistoric", () => {
  it("is the mean revenue, and the mean contribution over customers whose costs are known", () => {
    const r = ltvHistoric([
      { revenueMinor: 10_000, contributionMinor: 4000 },
      { revenueMinor: 20_000, contributionMinor: null },
      { revenueMinor: 30_000, contributionMinor: 8000 },
    ]);
    expect(r).toEqual({ customers: 3, revenueMinor: 20_000, contributionMinor: 6000, contributionCoverage: 2 / 3 });
  });

  it("has no contribution when no customer has known costs, and shows coverage 0", () => {
    const r = ltvHistoric([{ revenueMinor: 100, contributionMinor: null }]);
    expect(r).toEqual({ customers: 1, revenueMinor: 100, contributionMinor: null, contributionCoverage: 0 });
  });

  it("is all null with no customers", () => {
    expect(ltvHistoric([])).toEqual({ customers: 0, revenueMinor: null, contributionMinor: null, contributionCoverage: null });
  });

  it("rounds to a minor unit and keeps a negative contribution", () => {
    expect(ltvHistoric([{ revenueMinor: 1, contributionMinor: -3 }, { revenueMinor: 2, contributionMinor: -4 }])).toMatchObject({ revenueMinor: 2, contributionMinor: -3 });
  });
});

describe("ltvPredicted", () => {
  it("is contribution per order × orders per year × years", () => {
    expect(ltvPredicted({ contributionPerOrderMinor: 4000, revenuePerOrderMinor: 10_000, ordersPerYear: 1.5, lifespanYears: 3 })).toEqual({
      minor: 18_000,
      basis: "contribution",
      label: "Predicted lifetime contribution",
    });
  });

  it("falls back to revenue, and says so in the label", () => {
    const r = ltvPredicted({ contributionPerOrderMinor: null, revenuePerOrderMinor: 10_000, ordersPerYear: 1.2, lifespanYears: 2 });
    expect(r.minor).toBe(24_000);
    expect(r.basis).toBe("revenue");
    expect(r.label).toContain("revenue");
    expect(r.label).toContain("costs not entered");
  });

  it("uses a contribution of 0 or below as it is, never the revenue", () => {
    expect(ltvPredicted({ contributionPerOrderMinor: 0, revenuePerOrderMinor: 10_000, ordersPerYear: 2, lifespanYears: 3 })).toMatchObject({ minor: 0, basis: "contribution" });
    expect(ltvPredicted({ contributionPerOrderMinor: -500, revenuePerOrderMinor: 10_000, ordersPerYear: 2, lifespanYears: 3 }).minor).toBe(-3000);
  });

  it("rounds to a minor unit", () => {
    expect(ltvPredicted({ contributionPerOrderMinor: 3333, revenuePerOrderMinor: null, ordersPerYear: 1.1, lifespanYears: 3 }).minor).toBe(10_999);
  });

  it("is null when anything needed is missing or not above zero", () => {
    const base = { contributionPerOrderMinor: 4000, revenuePerOrderMinor: 10_000, ordersPerYear: 1.5, lifespanYears: 3 };
    expect(ltvPredicted({ ...base, ordersPerYear: null }).minor).toBeNull();
    expect(ltvPredicted({ ...base, ordersPerYear: 0 }).minor).toBeNull();
    expect(ltvPredicted({ ...base, lifespanYears: 0 }).minor).toBeNull();
    expect(ltvPredicted({ ...base, lifespanYears: Number.NaN }).minor).toBeNull();
    const none = ltvPredicted({ ...base, contributionPerOrderMinor: null, revenuePerOrderMinor: null });
    expect(none).toEqual({ minor: null, basis: null, label: "Predicted lifetime value" });
  });
});

describe("buildCohorts", () => {
  const om = (month: string, orders: number, revenueMinor: number): OrderMonth => ({ month, orders, revenueMinor });
  const may: { orderMonths: OrderMonth[] }[] = [
    { orderMonths: [om("2026-05", 1, 1000)] }, // never again
    { orderMonths: [om("2026-05", 2, 3000)] }, // twice in month 0
    { orderMonths: [om("2026-05", 1, 2000), om("2026-06", 1, 1500)] }, // again in month 1
    { orderMonths: [om("2026-05", 1, 1000), om("2026-08", 1, 500)] }, // again in month 3
  ];
  const sept = [{ orderMonths: [om("2026-09", 1, 4000)] }, { orderMonths: [om("2026-09", 1, 6000)] }];
  const october = [{ orderMonths: [om("2026-10", 1, 700)] }];
  const table = buildCohorts([...may, ...sept, ...october], "2026-10-15");
  const row = (cohort: string) => table.rows.find((r) => r.cohort === cohort)!;

  it("uses the documented offsets and puts the oldest cohort first", () => {
    expect(table.offsets).toEqual([0, 1, 2, 3, 6, 12]);
    expect(table.offsets).toEqual([...COHORT_OFFSETS]);
    expect(table.rows.map((r) => r.cohort)).toEqual(["2026-05", "2026-09", "2026-10"]);
    expect(table.rows.map((r) => r.size)).toEqual([4, 2, 1]);
  });

  it("counts who had bought again by the end of each month, cumulatively", () => {
    const r = row("2026-05");
    expect(r.repeaters).toEqual([1, 2, 2, 3, null, null]);
    expect(r.retention).toEqual([0.25, 0.5, 0.5, 0.75, null, null]);
  });

  it("works out cumulative revenue per customer of the cohort", () => {
    // month 0: 1000 + 3000 + 2000 + 1000 = 7000 over 4; month 1 adds 1500; month 3 adds 500
    expect(row("2026-05").revenuePerCustomerMinor).toEqual([1750, 2125, 2125, 2250, null, null]);
  });

  it("shows a month only once it is over: this month's cohort has nothing, last month's only its own month", () => {
    expect(row("2026-10").repeaters).toEqual([null, null, null, null, null, null]);
    expect(row("2026-10").retention.every((v) => v === null)).toBe(true);
    expect(row("2026-10").size).toBe(1);
    expect(row("2026-09").retention).toEqual([0, null, null, null, null, null]);
    expect(row("2026-09").revenuePerCustomerMinor).toEqual([5000, null, null, null, null, null]);
  });

  it("keeps the latest cohorts when there are more than maxCohorts", () => {
    const two = buildCohorts([...may, ...sept, ...october], "2026-10-15", 2);
    expect(two.rows.map((r) => r.cohort)).toEqual(["2026-09", "2026-10"]);
    expect(buildCohorts([...may, ...sept], "2026-10-15", 0).rows).toEqual([]);
  });

  it("limits the offsets to maxMonths", () => {
    const short = buildCohorts(may, "2026-10-15", 12, 3);
    expect(short.offsets).toEqual([0, 1, 2, 3]);
    expect(short.rows[0].repeaters).toEqual([1, 2, 2, 3]);
    expect(buildCohorts(may, "2026-10-15", 12, 0).offsets).toEqual([0]);
  });

  it("reaches month 6 and 12 for old enough cohorts", () => {
    const old = buildCohorts(
      [
        { orderMonths: [om("2025-06", 1, 100), om("2026-02", 1, 100)] }, // again in month 8
        { orderMonths: [om("2025-06", 1, 100), om("2025-12", 1, 100)] }, // again in month 6
      ],
      "2026-10-15",
    );
    expect(old.rows[0].repeaters).toEqual([0, 0, 0, 0, 1, 2]);
    expect(old.rows[0].revenuePerCustomerMinor).toEqual([100, 100, 100, 100, 150, 200]);
  });

  it("takes the cohort from the earliest month however they are listed, and adds the same month twice", () => {
    const t = buildCohorts([{ orderMonths: [om("2026-06", 1, 100), om("2026-05", 1, 100), om("2026-05", 1, 50)] }], "2026-10-15");
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].cohort).toBe("2026-05");
    expect(t.rows[0].repeaters[0]).toBe(1);
    expect(t.rows[0].revenuePerCustomerMinor[0]).toBe(150);
  });

  it("crosses a year end", () => {
    const t = buildCohorts([{ orderMonths: [om("2025-12", 1, 100), om("2026-01", 1, 100)] }], "2026-03-05");
    expect(t.rows[0].cohort).toBe("2025-12");
    expect(t.rows[0].repeaters.slice(0, 3)).toEqual([0, 1, 1]); // 2026-02 is over; the cohort's month 3 (2026-03) is not
    expect(t.rows[0].repeaters[3]).toBeNull();
  });

  it("leaves out customers with no usable month, and ignores bad entries", () => {
    const t = buildCohorts(
      [
        { orderMonths: [] },
        { orderMonths: [om("2026-13", 1, 5), om("x", 1, 5), om("2026-05", 0, 5)] },
        { orderMonths: [om("2026-05", 1, 100), om("2026-5", 1, 5), om("2026-06", Number.NaN, 5)] },
        {} as { orderMonths: OrderMonth[] },
      ],
      "2026-10-15",
    );
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].size).toBe(1);
    expect(t.rows[0].repeaters[1]).toBe(0);
  });

  it("takes a Date as now, and knows nothing is over when now is not a month", () => {
    expect(buildCohorts(may, new Date("2026-10-15T12:00:00Z")).rows[0].repeaters).toEqual([1, 2, 2, 3, null, null]);
    expect(buildCohorts(may, "2026-10").rows[0].repeaters[0]).toBe(1);
    expect(buildCohorts(may, "garbage").rows[0].repeaters.every((r) => r === null)).toBe(true);
  });

  it("is empty with no customers", () => {
    expect(buildCohorts([], "2026-10-15")).toEqual({ offsets: [0, 1, 2, 3, 6, 12], rows: [] });
  });
});

describe("cohortTrend", () => {
  const OFFSETS = [0, 1, 2, 3];
  /** A cohort row of a given size with the same number of repeaters at every offset (null where `from` says it is not reached). */
  const cohort = (month: string, size: number, repeaters: number, reached = 4): CohortRow => ({
    cohort: month,
    size,
    repeaters: OFFSETS.map((_, i) => (i < reached ? repeaters : null)),
    retention: OFFSETS.map((_, i) => (i < reached ? repeaters / size : null)),
    revenuePerCustomerMinor: OFFSETS.map(() => null),
  });
  const table = (rows: CohortRow[]): CohortTable => ({ offsets: OFFSETS, rows });

  it("says newer cohorts keep customers better when the difference is beyond chance", () => {
    const t = cohortTrend(
      table([cohort("2026-01", 50, 5), cohort("2026-02", 50, 5), cohort("2026-03", 50, 5), cohort("2026-04", 50, 15), cohort("2026-05", 50, 15), cohort("2026-06", 50, 15)]),
    );
    expect(t.verdict).toBe("better");
    expect(t.offset).toBe(3);
    expect(t.olderRate).toBeCloseTo(0.1, 10);
    expect(t.recentRate).toBeCloseTo(0.3, 10);
    expect(t.diff).toBeCloseTo(0.2, 10);
    expect(t.olderCohorts).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(t.recentCohorts).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(t.sentence).toBe("Newer customers come back more often: 30 % of newer customers had bought again by month 3, against 10 % of older ones.");
  });

  it("says worse when the newer cohorts keep fewer", () => {
    const t = cohortTrend(
      table([cohort("2026-01", 50, 15), cohort("2026-02", 50, 15), cohort("2026-03", 50, 15), cohort("2026-04", 50, 5), cohort("2026-05", 50, 5), cohort("2026-06", 50, 5)]),
    );
    expect(t.verdict).toBe("worse");
    expect(t.diff).toBeCloseTo(-0.2, 10);
    expect(t.sentence).toContain("less often");
  });

  it("says flat for a small difference, however the sizes", () => {
    const t = cohortTrend(
      table([cohort("2026-01", 50, 10), cohort("2026-02", 50, 10), cohort("2026-03", 50, 10), cohort("2026-04", 50, 11), cohort("2026-05", 50, 11), cohort("2026-06", 50, 11)]),
    );
    expect(t.verdict).toBe("flat");
    expect(t.sentence).toContain("about as often");
    expect(t.diff).toBeCloseTo(0.02, 10);
  });

  it("is flat, not better, for a big-looking difference on few customers", () => {
    // 4 of 100 against 9 of 100: five points, but z = 1.5
    const t = cohortTrend(table([cohort("2026-01", 50, 2), cohort("2026-02", 50, 2), cohort("2026-03", 50, 4), cohort("2026-04", 50, 5)]));
    expect(t.verdict).toBe("flat");
  });

  it("is flat when nobody ever came back, and when everybody did", () => {
    const rows = (n: number) => ["2026-01", "2026-02", "2026-03", "2026-04"].map((m) => cohort(m, 60, n));
    expect(cohortTrend(table(rows(0))).verdict).toBe("flat");
    expect(cohortTrend(table(rows(60))).verdict).toBe("flat");
  });

  it("uses the latest offset that has enough cohorts that have reached it", () => {
    const rows = [
      cohort("2026-01", 50, 5),
      cohort("2026-02", 50, 5),
      cohort("2026-03", 50, 5),
      cohort("2026-04", 50, 15, 2), // reached month 1 only
      cohort("2026-05", 50, 15, 2),
      cohort("2026-06", 50, 15, 2),
    ];
    const t = cohortTrend(table(rows));
    expect(t.offset).toBe(1);
    expect(t.verdict).toBe("better");
  });

  it("never compares month 0, and is unknown with only that", () => {
    const rows = ["2026-01", "2026-02", "2026-03", "2026-04"].map((m) => cohort(m, 60, 6, 1));
    const t = cohortTrend(table(rows));
    expect(t.verdict).toBe("unknown");
    expect(t.offset).toBeNull();
    expect(t.sentence).toMatch(/^Not enough customers/);
    expect(t.recentCohorts).toEqual([]);
  });

  it("leaves out cohorts that are too small, and needs enough customers on each side", () => {
    // sizes 33 give 99 a side: one short; 34 give 102
    const make = (size: number) => ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].map((m, i) => cohort(m, size, i < 3 ? 3 : 13));
    expect(cohortTrend(table(make(33))).verdict).toBe("unknown");
    expect(cohortTrend(table(make(34))).verdict).toBe("better");
    // a cohort under 20 is not counted: the four of 20 stay, the one of 10 goes
    const mixed = cohortTrend(table([cohort("2026-01", 10, 5), cohort("2026-02", 60, 6), cohort("2026-03", 60, 6), cohort("2026-04", 60, 6), cohort("2026-05", 60, 6)]));
    expect(mixed.olderCohorts).toEqual(["2026-02", "2026-03"]);
    expect(mixed.recentCohorts).toEqual(["2026-04", "2026-05"]);
  });

  it("with an odd number of cohorts the newer side has the extra one", () => {
    const t = cohortTrend(table(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"].map((m) => cohort(m, 60, 6))));
    expect(t.olderCohorts).toHaveLength(2);
    expect(t.recentCohorts).toHaveLength(3);
  });

  it("is unknown for fewer than four cohorts and for an empty table", () => {
    expect(cohortTrend(table([cohort("2026-01", 500, 5), cohort("2026-02", 500, 50), cohort("2026-03", 500, 50)])).verdict).toBe("unknown");
    expect(cohortTrend({ offsets: [0, 1, 2, 3, 6, 12], rows: [] }).verdict).toBe("unknown");
    expect(cohortTrend({ offsets: [], rows: [] }).verdict).toBe("unknown");
  });

  it("works on a table built by buildCohorts", () => {
    const om = (month: string, orders: number): OrderMonth => ({ month, orders, revenueMinor: orders * 100 });
    const customers: { orderMonths: OrderMonth[] }[] = [];
    ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].forEach((month, k) => {
      const next = `2026-0${k + 2}`;
      const returning = k < 3 ? 4 : 16; // of 40
      for (let i = 0; i < 40; i++) customers.push({ orderMonths: i < returning ? [om(month, 1), om(next, 1)] : [om(month, 1)] });
    });
    const t = cohortTrend(buildCohorts(customers, "2026-10-15"));
    expect(t.verdict).toBe("better");
    expect(t.offset).toBe(3);
    expect(t.olderRate).toBeCloseTo(0.1, 10);
    expect(t.recentRate).toBeCloseTo(0.4, 10);
  });
});

describe("quintileScores", () => {
  it("is empty for nothing, and 3 for a single value or all-equal values", () => {
    expect(quintileScores([])).toEqual([]);
    expect(quintileScores([42])).toEqual([3]);
    expect(quintileScores([2, 2, 2, 2])).toEqual([3, 3, 3, 3]);
  });

  it("gives five different values the scores 1 to 5, in any order", () => {
    expect(quintileScores([10, 20, 30, 40, 50])).toEqual([1, 2, 3, 4, 5]);
    expect(quintileScores([50, 10, 30, 20, 40])).toEqual([5, 1, 3, 2, 4]);
  });

  it("spreads ten different values two to a score", () => {
    expect(quintileScores([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("handles small populations: three values score 1, 3 and 5, two score 2 and 4", () => {
    expect(quintileScores([1, 2, 3])).toEqual([1, 3, 5]);
    expect(quintileScores([1, 2])).toEqual([2, 4]);
  });

  it("gives equal values one score, from the middle of their places (rank percentile with ties sharing the mid-rank)", () => {
    // Eight equal values hold places 0 to 7 of 10: their middle is 4 / 10 = 40 %, score 3; the two others sit at 90 %, score 5.
    expect(quintileScores([1, 1, 1, 1, 1, 1, 1, 1, 2, 2])).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 5, 5]);
    // A tie group at the bottom of a longer list is low, one at the top is high, and neither is spread over the scale.
    expect(quintileScores([1, 1, 5, 6, 7, 8, 9, 10, 11, 12])).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(quintileScores([1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 9])).toEqual([1, 1, 2, 2, 2, 3, 3, 4, 5, 5, 5, 5]);
  });

  it("is the same for equal values wherever they are in the list, and never depends on their order", () => {
    const values = [4, 9, 4, 1, 9, 9, 2, 4, 7, 4];
    const scores = quintileScores(values);
    for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) if (values[i] === values[j]) expect(scores[i]).toBe(scores[j]);
    expect(quintileScores([...values].reverse())).toEqual([...scores].reverse());
    // Higher values never score lower.
    for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) if (values[i] < values[j]) expect(scores[i]).toBeLessThanOrEqual(scores[j]);
  });

  it("handles negative values (recency is passed as minus days)", () => {
    expect(quintileScores([-30, -3, -100, -10, -60])).toEqual([3, 5, 1, 4, 2]);
  });

  it("always scores within 1 to 5", () => {
    for (let n = 1; n <= 60; n++) {
      const scores = quintileScores(Array.from({ length: n }, (_, i) => (i * 7) % 11));
      expect(scores.every((s) => s >= 1 && s <= 5 && Number.isInteger(s))).toBe(true);
    }
  });
});

describe("segmentOf", () => {
  const seg = (r: number, f: number, m: number, orders = 5, recencyDays = 100) => segmentOf({ r, f, m, orders, recencyDays });

  it("VIP: recent, frequent and big", () => {
    expect(seg(5, 5, 5)).toBe("VIP");
    expect(seg(4, 4, 4)).toBe("VIP");
    expect(seg(4, 5, 5, 20, 5)).toBe("VIP");
  });

  it("Loyal: frequent and not gone quiet, but not all three high", () => {
    expect(seg(4, 4, 3)).toBe("Loyal");
    expect(seg(3, 4, 1)).toBe("Loyal");
    expect(seg(3, 5, 5)).toBe("Loyal");
  });

  it("New: one order, within 30 days", () => {
    expect(seg(5, 1, 1, 1, 3)).toBe("New");
    expect(seg(5, 1, 1, 1, 30)).toBe("New");
    expect(seg(1, 1, 1, 1, 10)).toBe("New");
    expect(seg(5, 1, 1, 1, 31)).toBe("Promising");
    expect(seg(5, 2, 2, 2, 5)).toBe("Promising");
  });

  it("Promising: recently active, not yet frequent", () => {
    expect(seg(3, 1, 1, 3, 90)).toBe("Promising");
    expect(seg(4, 3, 3, 3, 40)).toBe("Promising");
  });

  it("At risk: gone quiet (R 1 or 2), but frequent or big before (F or M 4 or 5)", () => {
    expect(seg(2, 4, 1)).toBe("At risk");
    expect(seg(1, 1, 4)).toBe("At risk");
    expect(seg(2, 5, 5)).toBe("At risk");
    expect(seg(1, 4, 4)).toBe("At risk");
  });

  it("Lost: gone quiet, nothing above the middle; a 3 (the middle, or what a measure everyone shares scores) is not good", () => {
    expect(seg(2, 2, 2)).toBe("Lost");
    expect(seg(1, 1, 1, 1, 400)).toBe("Lost");
    expect(seg(1, 2, 1)).toBe("Lost");
    expect(seg(2, 3, 1)).toBe("Lost");
    expect(seg(1, 1, 3)).toBe("Lost");
    expect(seg(2, 3, 3, 1, 200)).toBe("Lost");
  });

  it("At risk and Lost need R 1 or 2: a recent customer is never either", () => {
    for (let r = 3; r <= 5; r++) for (let f = 1; f <= 5; f++) for (let m = 1; m <= 5; m++) for (const orders of [1, 4]) for (const recencyDays of [5, 90]) {
      expect(["At risk", "Lost"]).not.toContain(seg(r, f, m, orders, recencyDays));
    }
    for (let f = 1; f <= 5; f++) for (let m = 1; m <= 5; m++) for (const r of [1, 2]) {
      expect(["At risk", "Lost"]).toContain(seg(r, f, m, 1, 200));
    }
  });

  it("puts every combination in exactly one segment", () => {
    for (let r = 1; r <= 5; r++) for (let f = 1; f <= 5; f++) for (let m = 1; m <= 5; m++) for (const orders of [1, 4]) for (const recencyDays of [5, 90]) {
      expect(["VIP", "Loyal", "Promising", "New", "At risk", "Lost"]).toContain(seg(r, f, m, orders, recencyDays));
    }
  });
});

describe("rfm", () => {
  const customer = (key: string, days: number, orders: number, revenueMinor: number): Pick<CustomerAggregate, "key" | "lastOrderAt" | "orders" | "revenueMinor"> => ({
    key,
    lastOrderAt: ago(days),
    orders,
    revenueMinor,
  });

  it("scores each of five distinct customers 1 to 5 on each measure, most recent, most orders and most revenue best", () => {
    const rows = rfm(
      [customer("A", 3, 12, 90_000), customer("B", 21, 8, 60_000), customer("C", 61, 5, 40_000), customer("D", 214, 2, 15_000), customer("E", 365, 1, 5000)],
      new Date(NOW),
    );
    expect(rows.map((r) => r.score)).toEqual(["555", "444", "333", "222", "111"]);
    expect(rows.map((r) => r.recencyDays)).toEqual([3, 21, 61, 214, 365]);
    expect(rows.map((r) => r.segment)).toEqual(["VIP", "VIP", "Promising", "Lost", "Lost"]);
  });

  it("finds New, Promising, Loyal and At risk in a second table", () => {
    const rows = rfm(
      [customer("P", 3, 1, 1000), customer("Q", 10, 2, 2000), customer("R", 100, 20, 90_000), customer("S", 200, 15, 80_000), customer("T", 400, 3, 3000)],
      new Date(NOW),
    );
    expect(rows.map((r) => r.score)).toEqual(["511", "422", "355", "244", "133"]);
    expect(rows.map((r) => r.segment)).toEqual(["New", "Promising", "Loyal", "At risk", "Lost"]);
    expect(rows[0]).toMatchObject({ key: "P", r: 5, f: 1, m: 1, orders: 1, revenueMinor: 1000 });
  });

  it("scores ties alike: customers with the same single order share one frequency score, below those with more orders", () => {
    const rows = rfm([...Array.from({ length: 8 }, (_, i) => customer(`s${i}`, 10 + i, 1, 1000 + i)), customer("x", 5, 4, 9000), customer("y", 6, 3, 8000)], new Date(NOW));
    expect(new Set(rows.slice(0, 8).map((r) => r.f)).size).toBe(1);
    expect(rows[0].f).toBeLessThan(rows[8].f);
    expect(rows[8].f).toBe(5);
    expect(rows[9].f).toBe(5);
  });

  it("does not turn a population of one-order customers into At risk or Lost", () => {
    // 50 customers, one order each, one a week further back, with the same revenue and with different revenue.
    for (const revenue of [() => 5000, (i: number) => 1000 + i * 37]) {
      const rows = rfm(Array.from({ length: 50 }, (_, i) => customer(`c${i}`, 3 + i * 7, 1, revenue(i))), new Date(NOW));
      const summary = segmentSummary(rows);
      const count = (name: string) => summary.find((x) => x.segment === name)!.customers;
      expect(rows.every((r) => r.f === 3)).toBe(true);
      expect(count("New") + count("Promising")).toBeGreaterThanOrEqual(25);
      expect(count("At risk") + count("Lost")).toBeLessThanOrEqual(20);
      // Those two groups are the ones that have gone quiet, and no others.
      for (const r of rows) if (r.segment === "At risk" || r.segment === "Lost") expect(r.r).toBeLessThanOrEqual(2);
      for (const r of rows) if (r.r <= 2) expect(["At risk", "Lost"]).toContain(r.segment);
      // With equal revenue nobody is a "good customer who has left", so the quiet ones are Lost.
      if (revenue(0) === revenue(1)) expect(count("At risk")).toBe(0);
    }
  });

  it("gives everyone the same recency the middle score, so no one is quiet", () => {
    const rows = rfm(Array.from({ length: 10 }, (_, i) => customer(`c${i}`, 100, 1, 1000 + i)), new Date(NOW));
    expect(rows.every((r) => r.r === 3)).toBe(true);
    expect(rows.every((r) => r.segment !== "At risk" && r.segment !== "Lost")).toBe(true);
  });

  it("gives a customer whose last order is in the future a recency of 0, and leaves out one with no date", () => {
    const rows = rfm([{ ...customer("a", 0, 1, 100), lastOrderAt: "2026-12-01T00:00:00Z" }, { ...customer("b", 0, 1, 100), lastOrderAt: "garbage" }], new Date(NOW));
    expect(rows).toHaveLength(1);
    expect(rows[0].recencyDays).toBe(0);
  });

  it("is empty with no customers or with a now that is not a date", () => {
    expect(rfm([], new Date(NOW))).toEqual([]);
    expect(rfm([customer("a", 1, 1, 1)], "nope")).toEqual([]);
  });

  it("scores a single customer neutrally", () => {
    expect(rfm([customer("a", 50, 3, 3000)], new Date(NOW))[0]).toMatchObject({ r: 3, f: 3, m: 3, segment: "Promising" });
  });

  it("counts whole days, so a few hours is day 0", () => {
    expect(rfm([{ ...customer("a", 0, 1, 1), lastOrderAt: new Date(NOW - 5 * 3_600_000).toISOString() }], new Date(NOW))[0].recencyDays).toBe(0);
  });
});

describe("segmentSummary", () => {
  const rows = rfm(
    [
      { key: "P", lastOrderAt: ago(3), orders: 1, revenueMinor: 1000 },
      { key: "Q", lastOrderAt: ago(10), orders: 2, revenueMinor: 2000 },
      { key: "R", lastOrderAt: ago(100), orders: 20, revenueMinor: 90_000 },
      { key: "S", lastOrderAt: ago(200), orders: 15, revenueMinor: 80_000 },
      { key: "T", lastOrderAt: ago(400), orders: 3, revenueMinor: 3000 },
    ],
    new Date(NOW),
  );
  const summary = segmentSummary(rows);
  const of = (name: string) => summary.find((s) => s.segment === name)!;

  it("lists every segment in the documented order, empty ones included", () => {
    expect(summary.map((s) => s.segment)).toEqual(["VIP", "Loyal", "Promising", "New", "At risk", "Lost"]);
    expect(of("VIP")).toEqual({ segment: "VIP", customers: 0, customerShare: 0, revenueMinor: 0, revenueShare: 0, averageRevenueMinor: null, averageOrders: null, averageRecencyDays: null });
  });

  it("counts customers and revenue, with shares of the total", () => {
    // revenue in all: 176 000
    const risk = of("At risk");
    expect(risk.customers).toBe(1);
    expect(risk.customerShare).toBe(0.2);
    expect(risk.revenueMinor).toBe(80_000);
    expect(risk.revenueShare).toBeCloseTo(80_000 / 176_000, 10);
    expect(risk.averageRevenueMinor).toBe(80_000);
    expect(risk.averageOrders).toBe(15);
    expect(risk.averageRecencyDays).toBe(200);
    expect(of("Lost")).toMatchObject({ customers: 1, revenueMinor: 3000, averageOrders: 3, averageRecencyDays: 400 });
    expect(of("Loyal").revenueShare).toBeCloseTo(90_000 / 176_000, 10);
    expect(summary.reduce((a, s) => a + s.customers, 0)).toBe(5);
    expect(summary.reduce((a, s) => a + s.revenueMinor, 0)).toBe(176_000);
    expect(summary.reduce((a, s) => a + (s.revenueShare ?? 0), 0)).toBeCloseTo(1, 10);
  });

  it("has no shares with no customers", () => {
    const empty = segmentSummary([]);
    expect(empty).toHaveLength(6);
    expect(empty.every((s) => s.customers === 0 && s.customerShare === null && s.revenueShare === null)).toBe(true);
  });

  it("has no revenue share when no one has spent anything", () => {
    const zero = segmentSummary(rfm([{ key: "a", lastOrderAt: ago(1), orders: 1, revenueMinor: 0 }], new Date(NOW)));
    expect(zero.every((s) => s.revenueShare === null)).toBe(true);
    expect(zero.reduce((a, s) => a + s.customers, 0)).toBe(1);
  });
});
