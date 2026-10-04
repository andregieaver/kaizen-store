import { afterEach, describe, expect, it } from "vitest";

import { BASES, UNITS, baseFits, defaultBase, isSmallBase, type Measure, type Unit } from "./unit-price";
import { allowSmallBase } from "./unit-price-test-support";
import {
  UNIT_PRICE_COUNTRY_RULES,
  anySmallBaseAllowed,
  countryRule,
  effectiveBase,
  shownMeasureFor,
  shownMeasureFromColumns,
  snapshotMeasureFromColumns,
  smallBaseAllowed,
  smallBaseNote,
  unitPriceNeed,
  unitPriceNudge,
  unitPriceProblems,
  type UnitPriceFacts,
} from "./unit-price-rules";

describe("the country table", () => {
  it("has the four countries of the spec, each with a source and a verified flag", () => {
    expect(Object.keys(UNIT_PRICE_COUNTRY_RULES).sort()).toEqual(["DE", "DK", "NO", "SE"]);
    for (const [code, rule] of Object.entries(UNIT_PRICE_COUNTRY_RULES)) {
      expect(rule.source.length, code).toBeGreaterThan(20);
      expect(typeof rule.verified).toBe("boolean");
    }
  });

  it("closes the small base in every country of the table, and says what was read", () => {
    for (const [code, rule] of Object.entries(UNIT_PRICE_COUNTRY_RULES)) expect(rule.smallBaseAllowed, code).toBe(false);
    expect(UNIT_PRICE_COUNTRY_RULES.DE).toMatchObject({ smallBaseAllowed: false, verified: true });
    expect(UNIT_PRICE_COUNTRY_RULES.DE.source).toMatch(/2026-10-04/);
    // Norway and Sweden: the rules were read and name kg, l, m, m2 and piece only (review finding).
    expect(UNIT_PRICE_COUNTRY_RULES.NO).toMatchObject({ smallBaseAllowed: false, verified: true });
    expect(UNIT_PRICE_COUNTRY_RULES.NO.source).toMatch(/FOR-2012-11-14-1066/);
    expect(UNIT_PRICE_COUNTRY_RULES.NO.source).toMatch(/section 4/);
    expect(UNIT_PRICE_COUNTRY_RULES.NO.source).toMatch(/2026-10-04/);
    expect(UNIT_PRICE_COUNTRY_RULES.SE).toMatchObject({ smallBaseAllowed: false, verified: true });
    expect(UNIT_PRICE_COUNTRY_RULES.SE.source).toMatch(/KOVFS 2012:1/);
    expect(UNIT_PRICE_COUNTRY_RULES.SE.source).toMatch(/section 6/);
    // Denmark's text was not read: closed until it is, and flagged.
    expect(UNIT_PRICE_COUNTRY_RULES.DK).toMatchObject({ smallBaseAllowed: false, verified: false });
    expect(UNIT_PRICE_COUNTRY_RULES.DK.source).toMatch(/Not read in full/);
    // No row claims it is permitted without a source.
    for (const [code, rule] of Object.entries(UNIT_PRICE_COUNTRY_RULES)) expect(rule.source, code).not.toMatch(/Permitted without a source/);
  });

  it("treats every country that is not listed, and no country, as the large base", () => {
    for (const code of ["DE", "NO", "SE", "se", "DK", "FI", "FR", "NL", "PL", "XX", "", null, undefined]) expect(smallBaseAllowed(code), String(code)).toBe(false);
    expect(countryRule("FI")).toBeNull();
    expect(countryRule("no")?.verified).toBe(true);
    expect(countryRule("dk")?.verified).toBe(false);
  });
});

describe("the small base mechanism, with a country opened for the test", () => {
  let restore = () => {};
  afterEach(() => restore());

  it("opens and closes a country, and puts the table back as it was", () => {
    const before = JSON.stringify(UNIT_PRICE_COUNTRY_RULES);
    restore = allowSmallBase("NO", "ZZ");
    expect(smallBaseAllowed("NO")).toBe(true);
    expect(smallBaseAllowed("zz")).toBe(true);
    expect(smallBaseAllowed("SE")).toBe(false);
    restore();
    expect(JSON.stringify(UNIT_PRICE_COUNTRY_RULES)).toBe(before);
    expect(smallBaseAllowed("NO")).toBe(false);
  });

  it("gives the owner's small base only in an opened country", () => {
    restore = allowSmallBase("ZZ");
    expect(effectiveBase("g", "100g", "ZZ")).toBe("100g");
    expect(effectiveBase("ml", "100ml", "ZZ")).toBe("100ml");
    expect(effectiveBase("cl", "100ml", "ZZ")).toBe("100ml");
    expect(effectiveBase("g", "100g", "NO")).toBe("kg");
    expect(shownMeasureFor({ amount: "250", unit: "g" }, "100g", "ZZ")).toEqual({ amount: "250", unit: "g", base: "100g" });
    expect(shownMeasureFromColumns("250.0000", "g", "100g", "ZZ")).toEqual({ amount: "250", unit: "g", base: "100g" });
    expect(anySmallBaseAllowed(["NO", "ZZ"])).toBe(true);
  });
});

describe("effectiveBase", () => {
  it("returns the family's default when the owner chose none or chose the default", () => {
    for (const unit of UNITS) for (const country of ["NO", "DE", "FI"]) expect(effectiveBase(unit, null, country)).toBe(defaultBase(unit));
    expect(effectiveBase("g", "kg", "NO")).toBe("kg");
    expect(effectiveBase("l", "l", "DE")).toBe("l");
  });

  it("never gives a small base in Germany, Norway, Sweden or Denmark, whatever the owner chose", () => {
    for (const country of ["DE", "NO", "SE", "DK", "no", "se"]) {
      expect(effectiveBase("g", "100g", country), country).toBe("kg");
      expect(effectiveBase("kg", "100g", country), country).toBe("kg");
      expect(effectiveBase("ml", "100ml", country), country).toBe("l");
      expect(effectiveBase("cl", "100ml", country), country).toBe("l");
      expect(effectiveBase("l", "100ml", country), country).toBe("l");
    }
  });

  it("falls back to kg and l in countries not in the table", () => {
    expect(effectiveBase("g", "100g", "FI")).toBe("kg");
    expect(effectiveBase("g", "100g", undefined)).toBe("kg");
  });

  it("ignores a base that cannot compare the unit", () => {
    expect(effectiveBase("g", "l", "NO")).toBe("kg");
    expect(effectiveBase("m", "100g", "NO")).toBe("m");
  });

  it("is decided by the market's country only, for every unit and base", () => {
    const restore = allowSmallBase("ZZ");
    try {
      for (const unit of UNITS) {
        for (const base of BASES) {
          for (const country of ["NO", "SE", "DK", "DE", "FI", "ZZ"]) {
            const result = effectiveBase(unit, base, country);
            expect(baseFits(unit, result)).toBe(true);
            if (isSmallBase(result)) expect(smallBaseAllowed(country) && base === result && country === "ZZ").toBe(true);
          }
        }
      }
    } finally {
      restore();
    }
  });

  it("builds a shown measure with the effective base", () => {
    expect(shownMeasureFor({ amount: "250", unit: "g" }, "100g", "NO")).toEqual({ amount: "250", unit: "g", base: "kg" });
    expect(shownMeasureFor({ amount: "250", unit: "g" }, "100g", "DE")).toEqual({ amount: "250", unit: "g", base: "kg" });
  });

  it("reads columns as a market shows them", () => {
    expect(shownMeasureFromColumns("250.0000", "g", "100g", "NO")).toEqual({ amount: "250", unit: "g", base: "kg" });
    expect(shownMeasureFromColumns("250.0000", "g", "100g", "DE")).toEqual({ amount: "250", unit: "g", base: "kg" });
    expect(shownMeasureFromColumns("0.7500", "l", null, "NO")).toEqual({ amount: "0.75", unit: "l", base: "l" });
    expect(shownMeasureFromColumns(null, null, null, "NO")).toBeNull();
    expect(shownMeasureFromColumns("250", "stone", null, "NO")).toBeNull();
    expect(shownMeasureFromColumns("250", "g", "nonsense", "NO")).toEqual({ amount: "250", unit: "g", base: "kg" });
  });

  it("reads a snapshot as it was sold, without applying the country table again", () => {
    expect(snapshotMeasureFromColumns("250.0000", "g", "100g")).toEqual({ amount: "250", unit: "g", base: "100g" });
    expect(snapshotMeasureFromColumns(null, null, null)).toBeNull();
    expect(snapshotMeasureFromColumns("250", "g", null)).toBeNull();
    expect(snapshotMeasureFromColumns("250", "g", "l")).toBeNull();
  });

  it("writes the editor's note from the table", () => {
    expect(smallBaseNote(["NO", "SE"])).toMatch(/compared per kg or l in every market/);
    expect(smallBaseNote(["NO", "SE"])).not.toMatch(/allows it/);
    expect(smallBaseNote([])).toMatch(/Germany, Norway and Sweden/);
    const restore = allowSmallBase("ZZ");
    try {
      expect(smallBaseNote(["NO", "ZZ"])).toMatch(/only in the markets whose country's rule allows it/);
    } finally {
      restore();
    }
  });
});

const g250: Measure = { amount: "250", unit: "g" };
const variant = (over: Partial<UnitPriceFacts["variants"][number]> = {}): UnitPriceFacts["variants"][number] => ({
  sku: "KAFFE-250",
  title: "Kaffe 250 g",
  active: true,
  delivery: "physical",
  measure: null,
  ...over,
});
const facts = (over: Partial<UnitPriceFacts> = {}): UnitPriceFacts => ({
  status: "active",
  kind: "goods",
  soldByMeasure: false,
  categories: [],
  variants: [variant()],
  ...over,
});

describe("unitPriceNeed", () => {
  it("is not required until the owner says so", () => {
    expect(unitPriceNeed(facts())).toEqual({ required: false });
    expect(unitPriceNeed(facts({ categories: [{ name: "Food", requiresUnitPrice: false }] }))).toEqual({ required: false });
  });

  it("is required by the flag, first", () => {
    expect(unitPriceNeed(facts({ soldByMeasure: true, categories: [{ name: "Food", requiresUnitPrice: true }] }))).toEqual({ required: true, reason: "flag" });
  });

  it("is required by a marked category or ancestor in the chain", () => {
    expect(unitPriceNeed(facts({ categories: [{ name: "Sub", requiresUnitPrice: false }, { name: "Food", requiresUnitPrice: true }] }))).toEqual({
      required: true,
      reason: "category",
      category: "Food",
    });
  });
});

describe("unitPriceProblems", () => {
  it("refuses an active required product with an active physical variant that has no measure, with the sentence of the spec", () => {
    const problems = unitPriceProblems(facts({ soldByMeasure: true }));
    expect(problems).toEqual([
      {
        code: "unit_price.measure_required",
        sku: "KAFFE-250",
        message: "Add the content of Kaffe 250 g (SKU KAFFE-250): this product needs a price per kg or litre because it is sold by measure.",
      },
    ]);
  });

  it("names the category when that is why", () => {
    const [problem] = unitPriceProblems(facts({ categories: [{ name: "Food", requiresUnitPrice: true }] }));
    expect(problem.message).toBe("Add the content of Kaffe 250 g (SKU KAFFE-250): this product needs a price per kg or litre because its category Food is marked as needing one.");
  });

  it("accepts a measured variant and lists only the ones that lack it", () => {
    const two = facts({ soldByMeasure: true, variants: [variant({ measure: g250 }), variant({ sku: "B", title: "B" })] });
    expect(unitPriceProblems(two).map((p) => p.sku)).toEqual(["B"]);
    expect(unitPriceProblems(facts({ soldByMeasure: true, variants: [variant({ measure: g250 })] }))).toEqual([]);
  });

  it("lets a draft be saved incomplete, and ignores inactive and non-physical variants", () => {
    expect(unitPriceProblems(facts({ soldByMeasure: true, status: "draft" }))).toEqual([]);
    expect(unitPriceProblems(facts({ soldByMeasure: true, variants: [variant({ active: false })] }))).toEqual([]);
    expect(unitPriceProblems(facts({ soldByMeasure: true, variants: [variant({ delivery: "digital" })] }))).toEqual([]);
  });

  it("is quiet for a product nobody required, and for non-goods", () => {
    expect(unitPriceProblems(facts())).toEqual([]);
    expect(unitPriceProblems(facts({ kind: "stay", soldByMeasure: true, variants: [variant({ delivery: "service" })] }))).toEqual([]);
  });

  it("refuses a measure on a variant that is not physical goods, whatever the status", () => {
    const digital = unitPriceProblems(facts({ status: "draft", variants: [variant({ delivery: "digital", measure: g250 })] }));
    expect(digital.map((p) => p.code)).toEqual(["unit_price.not_applicable"]);
    const stay = unitPriceProblems(facts({ kind: "stay", variants: [variant({ delivery: "service", measure: g250 })] }));
    expect(stay.map((p) => p.code)).toEqual(["unit_price.not_applicable"]);
  });
});

describe("unitPriceNudge", () => {
  const vs = (measure: Measure | null) => [{ measure }];
  it("nudges food with no measure, and only that", () => {
    expect(unitPriceNudge({ vatCategory: "food", kind: "goods", variants: vs(null) })).toMatch(/Food is usually sold with a price per kg or litre/);
    expect(unitPriceNudge({ vatCategory: "food", kind: "goods", variants: vs(g250) })).toBeNull();
    expect(unitPriceNudge({ vatCategory: "standard", kind: "goods", variants: vs(null) })).toBeNull();
    expect(unitPriceNudge({ vatCategory: "food", kind: "stay", variants: vs(null) })).toBeNull();
  });
});

describe("types", () => {
  it("accepts every unit as a measure", () => {
    const units: Unit[] = [...UNITS];
    expect(units).toHaveLength(9);
  });
});
