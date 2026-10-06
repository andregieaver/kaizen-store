import { describe, expect, it } from "vitest";

import { CASH_RULES, cashRuleOf, cashRuleWords, checkCash } from "./cash-limits";

describe("the cash ceilings (D173 review)", () => {
  it("refuses cash of the Norwegian ceiling or more, in kroner, and lets less through", () => {
    expect(checkCash("NO", 3_999_999, "NOK")).toEqual({ kind: "ok" });
    expect(checkCash("no", 4_000_000, "NOK")).toMatchObject({ kind: "refuse" });
    expect(checkCash("NO", 6_000_000, "NOK")).toMatchObject({ kind: "refuse" });
  });

  it("warns, and does not refuse, where the rule is only reported", () => {
    expect(checkCash("DK", 1_500_000, "DKK")).toMatchObject({ kind: "warn" });
    expect(checkCash("DK", 1_499_900, "DKK")).toEqual({ kind: "ok" });
  });

  it("knows no rule for a country without a row, which is not a statement that there is none", () => {
    expect(cashRuleOf("SE")).toBeNull();
    expect(checkCash("SE", 99_999_999, "SEK")).toEqual({ kind: "ok" });
  });

  it("compares in another currency by the ceiling converted by the caller, and refuses a refuse rule it cannot convert", () => {
    expect(checkCash("NO", 400_000, "EUR", 430_000)).toEqual({ kind: "ok" });
    expect(checkCash("NO", 430_000, "EUR", 430_000)).toMatchObject({ kind: "refuse" });
    expect(checkCash("NO", 100, "EUR", null)).toMatchObject({ kind: "refuse" });
  });

  it("holds every rule as data with its source, and none is marked checked by a person yet", () => {
    for (const rule of Object.values(CASH_RULES)) {
      expect(rule.source.length).toBeGreaterThan(10);
      expect(rule.limitMinor).toBeGreaterThan(0);
      expect(rule.verified).toBe(false);
    }
    expect(cashRuleWords()).toContain("NO: Kaizen does not record cash of");
  });
});
