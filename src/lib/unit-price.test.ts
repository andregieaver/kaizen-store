import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { priceVat, WITH_VAT } from "./pricing";
import { withoutVat } from "./b2b";
import {
  BASES,
  UNITS,
  baseFits,
  baseQuantity,
  basesFor,
  defaultBase,
  formatMeasureAmount,
  hasUnitPrice,
  isSmallBase,
  measureFromColumns,
  measureProblem,
  measureQuantity,
  normaliseMeasureAmount,
  parseMeasureAmount,
  unitCode,
  unitPrice,
  unitPriceShown,
  type Base,
  type Measure,
  type Unit,
} from "./unit-price";

const m = (amount: string, unit: Unit): Measure => ({ amount, unit });
const minorOf = (shown: number, measure: Measure, base: Base) => {
  const result = unitPrice(shown, measure, base);
  return result.ok ? result.minor : result.reason;
};

describe("unitPrice: the rounding table of the spec (4.1)", () => {
  // shown minor, measure, base, expected (a figure, or the reason for none), why
  const table: [number, string, Unit, Base, number | string, string][] = [
    [4990, "250", "g", "kg", 19960, "4990 x 1000 / 250"],
    [4990, "250", "g", "100g", 1996, "4990 x 100 / 250"],
    [1999, "330", "ml", "l", 6058, "6057,57 rounds half up"],
    [1999, "33", "cl", "l", 6058, "cl is normalised: the same as 330 ml"],
    [2999, "0,75", "l", "l", 3999, "3998,67"],
    [1250, "6", "piece", "piece", 208, "208,33"],
    [5, "2", "kg", "kg", 3, "2,5 rounds up: half up, never banker's"],
    [4990, "1", "kg", "kg", "same_as_price", "Directive Art. 3(1)"],
    [4990, "1000", "g", "kg", "same_as_price", "the same quantity in another unit"],
    [0, "250", "g", "kg", "free", "a gift"],
    [1, "1000000", "g", "kg", "rounds_to_zero", "0,001 minor"],
    [3992, "250", "g", "kg", 15968, "a business buyer's price without VAT: withoutVat(4990, 0.25) is 3992"],
    [3990, "250", "g", "kg", 15960, "a reduced price: the unit price of the price charged"],
    [4999, "250", "g", "kg", 19996, "in NOK"],
    [435, "250", "g", "kg", 1740, "a euro view at 1 EUR = 11,5 NOK: round(4999 / 11,5) = 435, then x 4"],
    [25, "3", "m", "m", 8, "8,33"],
    [12, "0,5", "m2", "m2", 24, "m2 is the base"],
  ];
  for (const [shown, amount, unit, base, expected, why] of table) {
    it(`${shown} for ${amount} ${unit} per ${base} is ${expected} (${why})`, () => {
      expect(minorOf(shown, m(amount, unit), base)).toBe(expected);
    });
  }

  it("shows why computing from the shown euro price differs from converting the krone unit price", () => {
    const converted = Math.round(19996 / 11.5);
    expect(converted).toBe(1739);
    expect(minorOf(435, m("250", "g"), "kg")).toBe(1740);
    expect(minorOf(435, m("250", "g"), "kg")).not.toBe(converted);
  });

  it("rounds exactly half up at every half", () => {
    // 1 minor for 2 kg per kg is 0,5: rounds up to 1. 3 for 2 kg is 1,5 and 5 for 2 kg is 2,5.
    expect(minorOf(1, m("2", "kg"), "kg")).toBe(1);
    expect(minorOf(3, m("2", "kg"), "kg")).toBe(2);
    expect(minorOf(5, m("2", "kg"), "kg")).toBe(3);
    // Just under half: 1 minor for 3 kg per kg is 0,33.
    expect(minorOf(1, m("3", "kg"), "kg")).toBe("rounds_to_zero");
  });
});

describe("unitPrice: units, families and refusals", () => {
  it("normalises every unit of a family to the same figure for the same quantity", () => {
    const l = minorOf(1999, m("0.33", "l"), "l");
    expect(minorOf(1999, m("33", "cl"), "l")).toBe(l);
    expect(minorOf(1999, m("330", "ml"), "l")).toBe(l);
    expect(minorOf(1999, m("0.25", "kg"), "kg")).toBe(minorOf(1999, m("250", "g"), "kg"));
    expect(minorOf(1999, m("150", "cm"), "m")).toBe(minorOf(1999, m("1.5", "m"), "m"));
  });

  it("refuses a base of another kind of thing", () => {
    expect(minorOf(1999, m("250", "g"), "l")).toBe("family");
    expect(minorOf(1999, m("250", "ml"), "kg")).toBe("family");
    expect(minorOf(1999, m("2", "m"), "m2")).toBe("family");
    expect(minorOf(1999, m("2", "piece"), "kg")).toBe("family");
  });

  it("uses 100 ml and 100 g bases", () => {
    expect(minorOf(1999, m("330", "ml"), "100ml")).toBe(606); // 605,76
    expect(minorOf(4990, m("250", "g"), "100g")).toBe(1996);
  });

  it("returns a reason and never throws for what it cannot state", () => {
    expect(minorOf(-5, m("250", "g"), "kg")).toBe("free");
    expect(minorOf(1.5, m("250", "g"), "kg")).toBe("invalid");
    expect(minorOf(Number.NaN, m("250", "g"), "kg")).toBe("invalid");
    expect(minorOf(Number.MAX_SAFE_INTEGER + 2, m("250", "g"), "kg")).toBe("invalid");
    expect(minorOf(1000, m("0", "g"), "kg")).toBe("invalid");
    expect(minorOf(1000, m("abc", "g"), "kg")).toBe("invalid");
    expect(minorOf(1000, { amount: "250", unit: "stone" as Unit }, "kg")).toBe("invalid");
    expect(minorOf(1000, m("250", "g"), "tonne" as Base)).toBe("invalid");
    expect(minorOf(1000, undefined as unknown as Measure, "kg")).toBe("invalid");
  });

  it("refuses a result beyond the safe integer range", () => {
    // 9e15 minor for 0,0001 piece per piece: 9e19.
    expect(minorOf(9_000_000_000_000_000, m("0.0001", "piece"), "piece")).toBe("too_large");
    // And a big price for a big pack stays exact.
    expect(minorOf(9_000_000_000_000_000, m("1000000", "kg"), "kg")).toBe(9_000_000_000);
  });

  it("never gives 0 and never the price itself", () => {
    for (const unit of UNITS) {
      for (const base of BASES.filter((b) => baseFits(unit, b))) {
        for (const amount of ["0.0001", "0.5", "1", "100", "250", "1000", "1000000"]) {
          for (const shown of [1, 7, 99, 4990, 123_456_789]) {
            const result = unitPrice(shown, m(amount, unit), base);
            if (result.ok) expect(result.minor).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

/** The oracle: the exact rational shown x R / (A x f), rounded half up, in plain bigint, written independently. */
function oracle(shown: number, amount: string, unit: Unit, base: Base): bigint {
  const [whole, frac = ""] = amount.split(".");
  const a = BigInt(whole + frac.padEnd(4, "0")); // ten-thousandths
  const factor = BigInt({ g: 1, kg: 1000, ml: 1, cl: 10, l: 1000, cm: 1, m: 100, m2: 1, piece: 1 }[unit]);
  const r = BigInt({ kg: 1000, "100g": 100, l: 1000, "100ml": 100, m: 100, m2: 1, piece: 1 }[base]);
  const num = BigInt(shown) * r * BigInt(10000);
  const den = a * factor;
  const q = num / den;
  const rem = num % den;
  return rem * BigInt(2) >= den ? q + BigInt(1) : q;
}

describe("unitPrice: properties", () => {
  // A small deterministic generator, so a failure repeats.
  let seed = 20261004;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const amounts = ["0.0001", "0.001", "0.1", "0.33", "0.5", "0.75", "1", "1.5", "2", "3", "6", "12", "33", "250", "330", "500", "750", "999.9999", "1000", "12345.6789", "1000000"];

  it("equals an exact rational oracle (half up) over many random inputs", () => {
    for (let i = 0; i < 4000; i++) {
      const unit = UNITS[next(UNITS.length)];
      const bases = basesFor(unit);
      const base = bases[next(bases.length)];
      const amount = amounts[next(amounts.length)];
      const shown = 1 + next(2_000_000);
      const expected = oracle(shown, amount, unit, base);
      const result = unitPrice(shown, m(amount, unit), base);
      if (result.ok) {
        expect(BigInt(result.minor)).toBe(expected);
      } else if (result.reason === "rounds_to_zero") {
        expect(expected).toBe(BigInt(0));
      } else {
        expect(result.reason).toBe("same_as_price");
      }
    }
  });

  it("is monotone in the price and anti-monotone in the amount", () => {
    for (let i = 0; i < 500; i++) {
      const unit = UNITS[next(UNITS.length)];
      const base = defaultBase(unit);
      const amount = amounts[next(amounts.length)];
      const shown = 100 + next(1_000_000);
      const lower = minorOf(shown, m(amount, unit), base);
      const higher = minorOf(shown + 1 + next(1000), m(amount, unit), base);
      if (typeof lower === "number" && typeof higher === "number") expect(higher).toBeGreaterThanOrEqual(lower);
      const bigger = formatMeasureAmount(parseMeasureAmount(amount)! * 2);
      const small = minorOf(shown, m(amount, unit), base);
      const large = minorOf(shown, m(bigger, unit), base);
      if (typeof small === "number" && typeof large === "number") expect(large).toBeLessThanOrEqual(small);
    }
  });

  it("is within half a minor unit of the price once multiplied back", () => {
    for (let i = 0; i < 500; i++) {
      const shown = 1000 + next(1_000_000);
      const amount = amounts[next(amounts.length)];
      const result = unitPrice(shown, m(amount, "kg"), "kg");
      if (!result.ok) continue;
      // unit x amount / base quantity (1 kg) is the price, within rounding of the unit price (half a minor per kg).
      const back = (result.minor * parseMeasureAmount(amount)!) / 10_000;
      const halfUnit = (0.5 * parseMeasureAmount(amount)!) / 10_000;
      expect(Math.abs(back - shown)).toBeLessThanOrEqual(halfUnit + 1e-6);
    }
  });
});

describe("source: the arithmetic has no float", () => {
  it("does not round, parse or format a float anywhere in unit-price.ts", () => {
    const source = readFileSync(join(__dirname, "unit-price.ts"), "utf8")
      // Comments and strings are not code.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");
    expect(source).not.toMatch(/Math\.round|Math\.ceil|parseFloat|toFixed|Number\(/);
  });
});

describe("parseMeasureAmount", () => {
  it("reads what people type, as ten-thousandths", () => {
    expect(parseMeasureAmount("0,75")).toBe(7500);
    expect(parseMeasureAmount("1.5")).toBe(15000);
    expect(parseMeasureAmount("250")).toBe(2_500_000);
    expect(parseMeasureAmount(" 250 ")).toBe(2_500_000);
    expect(parseMeasureAmount("0.0001")).toBe(1);
    expect(parseMeasureAmount("1000000")).toBe(10_000_000_000);
    expect(parseMeasureAmount("0.1")).toBe(1000);
    expect(parseMeasureAmount("250.0000")).toBe(2_500_000);
  });

  it("refuses what is not a positive decimal of at most four decimals", () => {
    for (const bad of ["0", "0.0000", "-1", "1e3", "", " ", "abc", "1,000.5", "1.00001", "1000000.0001", "1000001", "1..5", ".5", "5.", "+5", "0x10", "12345678", "1 000"]) {
      expect(parseMeasureAmount(bad), bad).toBeNull();
    }
    expect(parseMeasureAmount(250 as unknown as string)).toBeNull();
    expect(parseMeasureAmount(null)).toBeNull();
  });

  it("formats the canonical text and round-trips", () => {
    expect(formatMeasureAmount(7500)).toBe("0.75");
    expect(formatMeasureAmount(2_500_000)).toBe("250");
    expect(formatMeasureAmount(15000)).toBe("1.5");
    expect(formatMeasureAmount(1)).toBe("0.0001");
    for (const text of ["0.75", "250", "1.5", "0.0001", "999999.9999", "1000000"]) {
      expect(formatMeasureAmount(parseMeasureAmount(text)!)).toBe(text);
    }
    expect(normaliseMeasureAmount("0,750")).toBe("0.75");
    expect(normaliseMeasureAmount("0")).toBeNull();
  });

  it("reads the database's numeric text back into a measure", () => {
    expect(measureFromColumns("250.0000", "g")).toEqual({ amount: "250", unit: "g" });
    expect(measureFromColumns("0.7500", "l")).toEqual({ amount: "0.75", unit: "l" });
    expect(measureFromColumns(null, null)).toBeNull();
    expect(measureFromColumns("250.0000", null)).toBeNull();
    expect(measureFromColumns("250.0000", "stone")).toBeNull();
    expect(measureFromColumns(0, "g")).toBeNull();
  });
});

describe("bases and families", () => {
  it("gives each unit its default and the bases it can be compared in", () => {
    expect(defaultBase("g")).toBe("kg");
    expect(defaultBase("kg")).toBe("kg");
    expect(defaultBase("ml")).toBe("l");
    expect(defaultBase("cl")).toBe("l");
    expect(defaultBase("l")).toBe("l");
    expect(defaultBase("cm")).toBe("m");
    expect(defaultBase("m")).toBe("m");
    expect(defaultBase("m2")).toBe("m2");
    expect(defaultBase("piece")).toBe("piece");
    expect(basesFor("g")).toEqual(["kg", "100g"]);
    expect(basesFor("cl")).toEqual(["l", "100ml"]);
    expect(basesFor("m")).toEqual(["m"]);
    expect(basesFor("piece")).toEqual(["piece"]);
  });

  it("knows the small bases", () => {
    expect(BASES.filter(isSmallBase)).toEqual(["100g", "100ml"]);
  });

  it("checks a base against a unit's family, for every pair", () => {
    for (const unit of UNITS) for (const base of BASES) expect(baseFits(unit, base)).toBe(basesFor(unit).includes(base));
  });
});

describe("unitPriceShown: the VAT display decides the amount", () => {
  const measure = m("250", "g");
  it("uses the price with VAT for consumers", () => {
    const shown = unitPriceShown(4990, WITH_VAT, measure, "kg");
    expect(shown.excl).toBeUndefined();
    expect(shown.incl).toEqual({ ok: true, minor: 19960, base: "kg" });
    expect(hasUnitPrice(shown)).toBe(true);
  });

  it("nets the price first, as the page shows it, for a business-only store (3992 gives 15968)", () => {
    const vat = priceVat("businesses", 0.25);
    expect(withoutVat(4990, 0.25)).toBe(3992);
    const shown = unitPriceShown(4990, vat, measure, "kg");
    expect(shown.incl).toBeUndefined();
    expect(shown.excl).toEqual({ ok: true, minor: 15968, base: "kg" });
  });

  it("gives both in a store selling to both, each from its own shown price", () => {
    const vat = priceVat("both", 0.25);
    const shown = unitPriceShown(4990, vat, measure, "kg");
    expect(shown.incl).toEqual({ ok: true, minor: 19960, base: "kg" });
    expect(shown.excl).toEqual({ ok: true, minor: 15968, base: "kg" });
  });

  it("gives the one a known buyer sees", () => {
    const vat = priceVat("both", 0.25);
    expect(unitPriceShown(4990, vat, measure, "kg", "private")).toEqual({ incl: { ok: true, minor: 19960, base: "kg" } });
    expect(unitPriceShown(4990, vat, measure, "kg", "business")).toEqual({ excl: { ok: true, minor: 15968, base: "kg" } });
    // A consumer store shows a business buyer the price with VAT too.
    expect(unitPriceShown(4990, WITH_VAT, measure, "kg", "business")).toEqual({ incl: { ok: true, minor: 19960, base: "kg" } });
  });

  it("carries the reason when nothing can be shown", () => {
    const shown = unitPriceShown(0, WITH_VAT, measure, "kg");
    expect(shown.incl).toEqual({ ok: false, reason: "free" });
    expect(hasUnitPrice(shown)).toBe(false);
  });
});

describe("structured data units", () => {
  it("codes every unit and base", () => {
    expect(UNITS.map(unitCode)).toEqual(["GRM", "KGM", "MLT", "CLT", "LTR", "CMT", "MTR", "MTK", "C62"]);
    expect(baseQuantity("kg")).toEqual({ value: "1", unitCode: "KGM" });
    expect(baseQuantity("100g")).toEqual({ value: "100", unitCode: "GRM" });
    expect(baseQuantity("l")).toEqual({ value: "1", unitCode: "LTR" });
    expect(baseQuantity("100ml")).toEqual({ value: "100", unitCode: "MLT" });
    expect(baseQuantity("m")).toEqual({ value: "1", unitCode: "MTR" });
    expect(baseQuantity("m2")).toEqual({ value: "1", unitCode: "MTK" });
    expect(baseQuantity("piece")).toEqual({ value: "1", unitCode: "C62" });
    expect(measureQuantity(m("0,750", "l"))).toEqual({ value: "0.75", unitCode: "LTR" });
  });
});

describe("measureProblem", () => {
  const goods = { kind: "goods", delivery: "physical" };
  it("accepts a good measure and no measure", () => {
    expect(measureProblem(null, goods)).toBeNull();
    expect(measureProblem({ amount: "250", unit: "g", base: null }, goods)).toBeNull();
    expect(measureProblem({ amount: "250", unit: "g", base: "100g" }, goods)).toBeNull();
    expect(measureProblem({ amount: "0,75", unit: "l", base: "l" }, goods)).toBeNull();
  });

  it("refuses a measure on anything but physical goods", () => {
    const input = { amount: "250", unit: "g", base: null };
    expect(measureProblem(input, { kind: "goods", delivery: "digital" })).toMatch(/physical goods/);
    expect(measureProblem(input, { kind: "goods", delivery: "service" })).toMatch(/physical goods/);
    for (const kind of ["appointment", "stay", "rental"]) {
      expect(measureProblem(input, { kind, delivery: "physical" })).toMatch(/physical goods/);
    }
  });

  it("refuses a bad amount, unit or base", () => {
    expect(measureProblem({ amount: "0", unit: "g", base: null }, goods)).toMatch(/Content must be a number/);
    expect(measureProblem({ amount: "1e3", unit: "g", base: null }, goods)).toMatch(/Content must be a number/);
    expect(measureProblem({ amount: "250", unit: "stone", base: null }, goods)).toMatch(/Choose a unit/);
    expect(measureProblem({ amount: "250", unit: "g", base: "tonne" }, goods)).toMatch(/compared per/);
    expect(measureProblem({ amount: "250", unit: "g", base: "l" }, goods)).toMatch(/cannot be compared per l/);
  });
});
