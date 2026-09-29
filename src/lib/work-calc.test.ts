import { describe, expect, it } from "vitest";

import {
  MAX_QUANTITY_HUNDREDTHS,
  MAX_UNIT_PRICE_MINOR,
  UNNAMED_LINE,
  billableAmountMinor,
  bpToPercent,
  bpToRateText,
  computeInvoice,
  computeLine,
  convertMinor,
  divideRounded,
  effectiveRate,
  formatHours,
  hundredthsToMinutes,
  isUnnamedLine,
  lineDescription,
  lineFromTask,
  mayMirrorHours,
  minorToDecimal,
  minutesToHundredths,
  parseDecimal,
  parseMoneyText,
  parsePercentText,
  parseQuantityText,
  planLineTaskSync,
  rateToBp,
  roundUpHours,
  roundUpMinutes,
  splitInclAmount,
  sumMinor,
  taskLineQuantity,
  timeAmountMinor,
  totalsMatch,
  totalsOf,
  type LineInput,
} from "./work-calc";

const line = (o: Partial<LineInput> = {}): LineInput => ({
  quantityHundredths: 100,
  unitPriceMinor: 100_000,
  discountBp: 0,
  vatBp: 2500,
  vatCategory: "standard",
  ...o,
});

describe("computeLine", () => {
  it("prices hours at a rate with VAT (the smoke case: 1.75 h at 1200)", () => {
    expect(computeLine(line({ quantityHundredths: 175, unitPriceMinor: 120_000 }))).toEqual({
      grossMinor: 210_000,
      discountMinor: 0,
      exclMinor: 210_000,
      vatMinor: 52_500,
      inclMinor: 262_500,
    });
  });

  it("rounds half up to the minor unit, once per amount", () => {
    // 0.33 h x 900.50 = 297.165 -> 297.17 (29716.5 minor rounds up)
    expect(computeLine(line({ quantityHundredths: 33, unitPriceMinor: 90_050, vatBp: 0 })).exclMinor).toBe(29_717);
    // VAT: 297.17 x 25 % = 74.2925 -> 74.29
    expect(computeLine(line({ quantityHundredths: 33, unitPriceMinor: 90_050 })).vatMinor).toBe(7_429);
    // an exact half rounds up: 0.02 h x 25.00 = 0.5 minor
    expect(computeLine(line({ quantityHundredths: 2, unitPriceMinor: 25, vatBp: 0 })).exclMinor).toBe(1);
    expect(computeLine(line({ quantityHundredths: 1, unitPriceMinor: 49, vatBp: 0 })).exclMinor).toBe(0);
  });

  it("takes a discount in basis points and reports it", () => {
    // 1 x 100.01 less 12.5 % = 87.50875 -> 87.51; gross 100.01; discount 12.50
    const a = computeLine(line({ quantityHundredths: 100, unitPriceMinor: 10_001, discountBp: 1250, vatBp: 0 }));
    expect(a.exclMinor).toBe(8_751);
    expect(a.grossMinor).toBe(10_001);
    expect(a.discountMinor).toBe(1_250);
    expect(computeLine(line({ discountBp: 10_000 })).exclMinor).toBe(0);
  });

  it("rounds VAT per line, so lines add up to the totals", () => {
    // two lines of 0.02 net at 25 %: each VAT 0.005 rounds to 0.01; per total it would be 0.01
    const a = line({ quantityHundredths: 100, unitPriceMinor: 2 });
    expect(computeLine(a).vatMinor).toBe(1);
    const { totals } = computeInvoice([a, a]);
    expect(totals).toMatchObject({ subtotalMinor: 4, vatMinor: 2, totalMinor: 6 });
  });

  it("stays exact where a float product cannot", () => {
    const q = 9_999_999;
    const p = 999_999_999;
    const bp = 1_234;
    // The naive product is beyond 2^53, so it is not even a safe integer.
    expect(q * p * (10_000 - bp)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    const exact = (BigInt(q) * BigInt(p) * BigInt(10_000 - bp) + BigInt(500_000)) / BigInt(1_000_000);
    expect(computeLine(line({ quantityHundredths: q, unitPriceMinor: p, discountBp: bp, vatBp: 0 })).exclMinor).toBe(
      Number(exact),
    );
  });

  it("handles the largest line", () => {
    const l = computeLine(
      line({ quantityHundredths: MAX_QUANTITY_HUNDREDTHS, unitPriceMinor: MAX_UNIT_PRICE_MINOR, vatBp: 2500 }),
    );
    expect(l.exclMinor).toBe(100_000_000_000_000); // 100 000 h x 10 000 000 = 1e12 whole units, in minor units 1e14
    expect(l.vatMinor).toBe(25_000_000_000_000);
    expect(l.inclMinor).toBe(125_000_000_000_000);
  });

  it("refuses input out of range instead of clamping it", () => {
    expect(() => computeLine(line({ quantityHundredths: -1 }))).toThrow(RangeError);
    expect(() => computeLine(line({ quantityHundredths: MAX_QUANTITY_HUNDREDTHS + 1 }))).toThrow(RangeError);
    expect(() => computeLine(line({ unitPriceMinor: MAX_UNIT_PRICE_MINOR + 1 }))).toThrow(RangeError);
    expect(() => computeLine(line({ unitPriceMinor: 1.5 }))).toThrow(RangeError);
    expect(() => computeLine(line({ discountBp: 10_001 }))).toThrow(RangeError);
    expect(() => computeLine(line({ vatBp: -1 }))).toThrow(RangeError);
    expect(() => computeLine(line({ quantityHundredths: Number.NaN }))).toThrow(RangeError);
  });
});

describe("invoice totals", () => {
  it("adds the lines' rounded amounts and groups VAT by category and rate", () => {
    const { lines, totals } = computeInvoice([
      line({ quantityHundredths: 175, unitPriceMinor: 120_000 }),
      line({ quantityHundredths: 100, unitPriceMinor: 50_000, vatBp: 0, vatCategory: "exempt" }),
      line({ quantityHundredths: 100, unitPriceMinor: 10_000, vatBp: 0, vatCategory: "reverse_charge" }),
      line({ quantityHundredths: 200, unitPriceMinor: 10_000 }),
    ]);
    expect(lines.map((l) => l.inclMinor)).toEqual([262_500, 50_000, 10_000, 25_000]);
    expect(totals.subtotalMinor).toBe(210_000 + 50_000 + 10_000 + 20_000);
    expect(totals.vatMinor).toBe(52_500 + 5_000);
    expect(totals.totalMinor).toBe(totals.subtotalMinor + totals.vatMinor);
    expect(totals.vatGroups).toEqual([
      { category: "standard", vatBp: 2500, netMinor: 230_000, vatMinor: 57_500, grossMinor: 287_500 },
      { category: "exempt", vatBp: 0, netMinor: 50_000, vatMinor: 0, grossMinor: 50_000 },
      { category: "reverse_charge", vatBp: 0, netMinor: 10_000, vatMinor: 0, grossMinor: 10_000 },
    ]);
    expect(totals.vatGroups.reduce((s, g) => s + g.vatMinor, 0)).toBe(totals.vatMinor);
  });

  it("an empty invoice is zero", () => {
    expect(computeInvoice([]).totals).toEqual({
      subtotalMinor: 0,
      discountMinor: 0,
      vatMinor: 0,
      totalMinor: 0,
      vatGroups: [],
    });
  });

  it("adds up discounts", () => {
    const { totals } = computeInvoice([
      line({ quantityHundredths: 100, unitPriceMinor: 10_001, discountBp: 1250 }),
      line({ quantityHundredths: 100, unitPriceMinor: 20_000, discountBp: 500 }),
    ]);
    expect(totals.discountMinor).toBe(1_250 + 1_000);
  });

  it("sums past 2^53 exactly or refuses, never silently wrong", () => {
    const big = line({ quantityHundredths: MAX_QUANTITY_HUNDREDTHS, unitPriceMinor: MAX_UNIT_PRICE_MINOR, vatBp: 0 });
    // 1e14 per line: 90 lines is 9e15, just under 2^53 (9.007e15)
    const ok = computeInvoice(Array.from({ length: 90 }, () => big));
    expect(ok.totals.subtotalMinor).toBe(9_000_000_000_000_000);
    // 91 lines would be 9.1e15, over the limit
    expect(() => computeInvoice(Array.from({ length: 91 }, () => big))).toThrow(RangeError);
  });

  it("checks header totals against the lines, as issue does", () => {
    const lines = [line({ quantityHundredths: 175, unitPriceMinor: 120_000 })];
    expect(totalsMatch({ subtotalMinor: 210_000, vatMinor: 52_500, totalMinor: 262_500 }, lines)).toBe(true);
    expect(totalsMatch({ subtotalMinor: 210_000, vatMinor: 52_501, totalMinor: 262_501 }, lines)).toBe(false);
  });

  it("totalsOf works from stored amounts too", () => {
    const totals = totalsOf([
      {
        grossMinor: 10,
        discountMinor: 0,
        exclMinor: 10,
        vatMinor: 3,
        inclMinor: 13,
        vatBp: 2500,
        vatCategory: "standard",
      },
    ]);
    expect(totals.totalMinor).toBe(13);
  });
});

describe("sumMinor and divideRounded", () => {
  it("sums exactly and refuses to overflow", () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(sumMinor([])).toBe(0);
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
    expect(() => sumMinor([0.5])).toThrow(RangeError);
  });

  it("rounds halves away from zero", () => {
    expect(divideRounded(BigInt(5), BigInt(2))).toBe(BigInt(3));
    expect(divideRounded(BigInt(4), BigInt(3))).toBe(BigInt(1));
    expect(divideRounded(BigInt(-5), BigInt(2))).toBe(BigInt(-3));
    expect(() => divideRounded(BigInt(1), BigInt(0))).toThrow(RangeError);
  });
});

describe("hours and minutes", () => {
  it("turns minutes into hundredths of an hour, half up (Life: 20 min is 0.33 h)", () => {
    const cases: [number, number][] = [
      [0, 0],
      [1, 2],
      [3, 5],
      [4, 7],
      [7, 12],
      [20, 33],
      [45, 75],
      [60, 100],
      [90, 150],
      [105, 175],
      [1440, 2400],
    ];
    for (const [minutes, hundredths] of cases) expect(minutesToHundredths(minutes)).toBe(hundredths);
  });

  it("agrees with Life's round(minutes / 60 * 100) / 100 for every minute of a day", () => {
    for (let m = 0; m <= 1440; m += 1) {
      expect(minutesToHundredths(m)).toBe(Math.round((m / 60) * 100));
    }
  });

  it("turns hundredths back into minutes", () => {
    expect(hundredthsToMinutes(33)).toBe(20);
    expect(hundredthsToMinutes(175)).toBe(105);
    expect(hundredthsToMinutes(0)).toBe(0);
  });

  it("refuses fractions and negatives", () => {
    expect(() => minutesToHundredths(1.5)).toThrow(RangeError);
    expect(() => minutesToHundredths(-1)).toThrow(RangeError);
  });

  it("rounds up to the next started period (Life's smoke cases, in hundredths)", () => {
    const cases: [number, 15 | 30 | 60, number][] = [
      [248, 15, 250],
      [250, 15, 250],
      [251, 15, 275],
      [102, 30, 150],
      [100, 30, 100],
      [2, 60, 100],
      [200, 60, 200],
      [201, 60, 300],
      [0, 15, 0],
      [100, 60, 100], // Life's 0.999999 h (one hour, in floating point) is one hour
    ];
    for (const [h, step, want] of cases) expect(roundUpHours(h, step)).toBe(want);
  });

  it("rounds minutes up to a step", () => {
    expect(roundUpMinutes(61, 30)).toBe(90);
    expect(roundUpMinutes(60, 30)).toBe(60);
    expect(roundUpMinutes(0, 15)).toBe(0);
    expect(() => roundUpMinutes(10, 0)).toThrow(RangeError);
  });
});

describe("rates and billable amounts", () => {
  const client = { defaultHourlyRateMinor: 90_000 };
  it("uses the assignment's rate, then the client's, then none", () => {
    expect(effectiveRate({ billingType: "hourly", hourlyRateMinor: 120_000 }, client)).toEqual({
      rateMinor: 120_000,
      source: "assignment",
    });
    expect(effectiveRate({ billingType: "hourly", hourlyRateMinor: null }, client)).toEqual({
      rateMinor: 90_000,
      source: "client",
    });
    expect(effectiveRate({ billingType: "hourly", hourlyRateMinor: null }, { defaultHourlyRateMinor: null })).toEqual({
      rateMinor: 0,
      source: "none",
    });
    expect(effectiveRate({ billingType: "fixed_fee", hourlyRateMinor: 5 }, client).source).toBe("none");
  });

  it("counts an assignment rate of zero as set", () => {
    expect(effectiveRate({ billingType: "hourly", hourlyRateMinor: 0 }, client)).toEqual({
      rateMinor: 0,
      source: "assignment",
    });
  });

  it("prices billable minutes as an invoice line would", () => {
    const a = { billingType: "hourly" as const, hourlyRateMinor: 120_000, fixedAmountMinor: null };
    expect(billableAmountMinor(a, client, 105)).toBe(210_000);
    expect(billableAmountMinor({ ...a, hourlyRateMinor: null }, client, 20)).toBe(29_700); // 0.33 h x 900
    expect(billableAmountMinor({ ...a, billingType: "fixed_fee", fixedAmountMinor: 500_000 }, client, 999)).toBe(
      500_000,
    );
    expect(billableAmountMinor({ ...a, billingType: "fixed_fee", fixedAmountMinor: null }, client, 999)).toBe(0);
    expect(timeAmountMinor(0, 120_000)).toBe(0);
  });
});

describe("recurring amounts and rates", () => {
  it("splits a VAT-inclusive amount, as Life's recurring templates did", () => {
    expect(splitInclAmount(125_000, 2500)).toEqual({ exclMinor: 100_000, vatMinor: 25_000, inclMinor: 125_000 });
    expect(splitInclAmount(9_999, 2500)).toEqual({ exclMinor: 7_999, vatMinor: 2_000, inclMinor: 9_999 });
    expect(splitInclAmount(10_000, 0)).toEqual({ exclMinor: 10_000, vatMinor: 0, inclMinor: 10_000 });
    expect(splitInclAmount(0, 2500)).toEqual({ exclMinor: 0, vatMinor: 0, inclMinor: 0 });
  });

  it("converts VAT rates between fractions and basis points", () => {
    expect(rateToBp(0.25)).toBe(2500);
    expect(rateToBp(0.255)).toBe(2550);
    expect(rateToBp(0.0625)).toBe(625);
    expect(bpToRateText(2500)).toBe("0.2500");
    expect(bpToRateText(10_000)).toBe("1.0000");
    expect(bpToRateText(0)).toBe("0.0000");
    expect(() => rateToBp(25)).toThrow(RangeError);
  });

  it("converts VAT to the home currency with a decimal rate, half up", () => {
    expect(convertMinor(100_000, "11.6543")).toBe(1_165_430);
    expect(convertMinor(1, "0.5")).toBe(1);
    expect(convertMinor(1, "0.49")).toBe(0);
    expect(convertMinor(25_000, "0.08765432")).toBe(2_191);
    expect(() => convertMinor(1, "0")).toThrow(RangeError);
    expect(() => convertMinor(1, "abc")).toThrow(RangeError);
    expect(() => convertMinor(1, "1.123456789")).toThrow(RangeError);
  });
});

describe("lines and tasks stay one piece of work", () => {
  it("names an unnamed line with the placeholder", () => {
    expect(lineDescription("")).toBe(UNNAMED_LINE);
    expect(lineDescription("   ")).toBe(UNNAMED_LINE);
    expect(lineDescription(null)).toBe(UNNAMED_LINE);
    expect(lineDescription("  Design review ")).toBe("Design review");
    expect(isUnnamedLine(UNNAMED_LINE)).toBe(true);
    expect(isUnnamedLine("Design review")).toBe(false);
  });

  it("mirrors a task as a draft line: the assignment's rate, the estimate as quantity (smoke: 2.5 h at 1200)", () => {
    const price = { rateMinor: 120_000, vatBp: 2500, vatCategory: "standard" as const };
    expect(lineFromTask({ title: "Design review", estimatedMinutes: 150 }, price)).toEqual({
      description: "Design review",
      quantityHundredths: 250,
      unitPriceMinor: 120_000,
      discountBp: 0,
      vatBp: 2500,
      vatCategory: "standard",
    });
    expect(lineFromTask({ title: "", estimatedMinutes: null }, price)).toMatchObject({
      description: UNNAMED_LINE,
      quantityHundredths: 0,
    });
  });

  it("takes logged billable minutes as the line's hours (smoke: 90 + 15 billable, 30 not, is 1.75 h)", () => {
    expect(taskLineQuantity(90 + 15)).toBe(175);
    expect(taskLineQuantity(0)).toBe(0);
  });

  it("does not let logged time rewrite fixed fees or quantities the owner typed", () => {
    expect(mayMirrorHours({ quantityManual: false, assignmentBilling: "hourly" })).toBe(true);
    expect(mayMirrorHours({ quantityManual: false, assignmentBilling: null })).toBe(true);
    expect(mayMirrorHours({ quantityManual: true, assignmentBilling: "hourly" })).toBe(false);
    expect(mayMirrorHours({ quantityManual: false, assignmentBilling: "fixed_fee" })).toBe(false);
    expect(
      mayMirrorHours({ quantityManual: false, assignmentBilling: "hourly", lineAssignmentBilling: "fixed_fee" }),
    ).toBe(false);
  });

  it("gives an unpaired line a task, with the line's quantity as its estimate", () => {
    const plan = planLineTaskSync({
      lines: [
        { id: "l1", taskId: null, description: UNNAMED_LINE, quantityHundredths: 100 },
        { id: "l2", taskId: null, description: "Copywriting", quantityHundredths: 0 },
        { id: "l3", taskId: "gone", description: "Orphan", quantityHundredths: 50 },
      ],
      tasks: [],
      removedTaskIds: [],
    });
    expect(plan.createTasks).toEqual([
      { lineId: "l1", title: UNNAMED_LINE, estimatedMinutes: 60 },
      { lineId: "l2", title: "Copywriting", estimatedMinutes: null },
      { lineId: "l3", title: "Orphan", estimatedMinutes: 30 },
    ]);
    expect(plan.renameTasks).toEqual([]);
    expect(plan.deleteTaskIds).toEqual([]);
  });

  it("renames a task to match its line and leaves matching ones alone", () => {
    const plan = planLineTaskSync({
      lines: [
        { id: "l1", taskId: "t1", description: "Copywriting", quantityHundredths: 100 },
        { id: "l2", taskId: "t2", description: "Same", quantityHundredths: 100 },
        { id: "l3", taskId: "t3", description: "  ", quantityHundredths: 100 },
      ],
      tasks: [
        { id: "t1", title: "Design review (final)" },
        { id: "t2", title: "Same" },
        { id: "t3", title: "Something" },
      ],
      removedTaskIds: [],
    });
    expect(plan.renameTasks).toEqual([
      { taskId: "t1", title: "Copywriting" },
      { taskId: "t3", title: UNNAMED_LINE },
    ]);
    expect(plan.createTasks).toEqual([]);
  });

  it("deletes the tasks of removed lines, unless a line still uses one", () => {
    const plan = planLineTaskSync({
      lines: [{ id: "l1", taskId: "t1", description: "Kept", quantityHundredths: 100 }],
      tasks: [
        { id: "t1", title: "Kept" },
        { id: "t2", title: "Removed" },
      ],
      removedTaskIds: ["t2", "t2", "t1"],
    });
    expect(plan.deleteTaskIds).toEqual(["t2"]);
  });
});

describe("typed text", () => {
  it("reads decimals exactly with a comma or a dot, rounding half up past the last place", () => {
    expect(parseDecimal("1,25", 2)).toBe(125);
    expect(parseDecimal("1.25", 2)).toBe(125);
    expect(parseDecimal("1.254", 2)).toBe(125);
    expect(parseDecimal("1.255", 2)).toBe(126);
    expect(parseDecimal("0,005", 2)).toBe(1);
    expect(parseDecimal("12", 2)).toBe(1200);
    expect(parseDecimal(".5", 2)).toBe(50);
    expect(parseDecimal("1 000,5", 2)).toBe(100_050);
    expect(parseDecimal("", 2)).toBeNull();
    expect(parseDecimal(",", 2)).toBeNull();
    expect(parseDecimal("-1", 2)).toBeNull();
    expect(parseDecimal("1e3", 2)).toBeNull();
    expect(parseDecimal("1.2.3", 2)).toBeNull();
    expect(parseDecimal("99999999999999999999", 2)).toBeNull();
  });

  it("reads quantities, percentages and money within their limits", () => {
    expect(parseQuantityText("1,75")).toBe(175);
    expect(parseQuantityText("100000")).toBe(MAX_QUANTITY_HUNDREDTHS);
    expect(parseQuantityText("100000,01")).toBeNull();
    expect(parsePercentText("12,5")).toBe(1250);
    expect(parsePercentText("100")).toBe(10_000);
    expect(parsePercentText("100,01")).toBeNull();
    expect(parseMoneyText("1 249,50", "NOK")).toBe(124_950);
    expect(parseMoneyText("10000000", "NOK")).toBe(MAX_UNIT_PRICE_MINOR);
    expect(parseMoneyText("10000001", "NOK")).toBeNull();
    expect(parseMoneyText("abc", "NOK")).toBeNull();
  });

  it("writes plain decimals from integers", () => {
    expect(minorToDecimal(123_450, "NOK")).toBe("1234.50");
    expect(minorToDecimal(5, "EUR")).toBe("0.05");
    expect(minorToDecimal(-5, "EUR")).toBe("-0.05");
    expect(minorToDecimal(0, "SEK")).toBe("0.00");
    expect(minorToDecimal(9_007_199_254_740_991, "EUR")).toBe("90071992547409.91");
    expect(() => minorToDecimal(0.5, "EUR")).toThrow(RangeError);
    expect(bpToPercent(2500)).toBe("25");
    expect(bpToPercent(1250)).toBe("12.5");
    expect(bpToPercent(5)).toBe("0.05");
    expect(bpToPercent(1)).toBe("0.01");
    expect(bpToPercent(0)).toBe("0");
    expect(bpToPercent(10_000)).toBe("100");
  });

  it("shows hours in the locale", () => {
    expect(formatHours(175, "nb-NO")).toBe("1,75 h");
    expect(formatHours(175, "en")).toBe("1.75 h");
    expect(formatHours(0, "en")).toBe("0.00 h");
  });
});
