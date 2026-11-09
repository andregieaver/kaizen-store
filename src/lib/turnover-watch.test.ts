import { describe, expect, it } from "vitest";

import { isLimitedCompany, NO_THRESHOLDS, shortAmount, watchThresholds } from "./turnover-watch";

const own = [{ id: "acct", amountMinor: 500_000_000, currency: "NOK", note: "invite your accountant" }];
const watch = (turnover: number, monthAgo: number, legalName = "Human Web André Giæver") =>
  watchThresholds({ turnoverMinor: turnover, turnoverMonthAgoMinor: monthAgo, currency: "NOK", legalName, legal: NO_THRESHOLDS, own });

describe("the threshold watch (D514)", () => {
  it("says an owner's threshold from 85 % and keeps saying it once passed", () => {
    expect(watch(400_000_000, 380_000_000)).toEqual([]);
    expect(watch(430_000_000, 400_000_000)).toEqual([{ kind: "own", id: "acct", note: "invite your accountant", state: "near", amountMinor: 500_000_000, currency: "NOK", turnoverMinor: 430_000_000 }]);
    expect(watch(510_000_000, 480_000_000)[0]).toMatchObject({ kind: "own", state: "passed" });
    expect(watch(600_000_000, 600_000_000)[0]).toMatchObject({ kind: "own", state: "passed" });
  });

  it("says a legal threshold when near, and once passed only for the month after", () => {
    expect(watch(4_500_000, 4_000_000).map((w) => [w.kind, w.state])).toEqual([["legal", "near"]]);
    expect(watch(5_200_000, 4_900_000).map((w) => [w.kind, w.state])).toEqual([["legal", "passed"]]);
    // Long past VAT registration: not said again.
    expect(watch(300_000_000, 290_000_000)).toEqual([]);
  });

  it("watches the audit limit only for a limited company", () => {
    expect(isLimitedCompany("Human Web AS")).toBe(true);
    expect(isLimitedCompany("Equinor ASA")).toBe(true);
    expect(isLimitedCompany("Human Web André Giæver")).toBe(false);
    expect(isLimitedCompany("Aspen Design")).toBe(false);
    expect(watch(620_000_000, 610_000_000, "Human Web AS").map((w) => (w.kind === "legal" ? w.key : w.kind))).toEqual(["own", "audit_as"]);
    expect(watch(620_000_000, 610_000_000).map((w) => (w.kind === "legal" ? w.key : w.kind))).toEqual(["own"]);
  });

  it("leaves out thresholds in another currency, and says amounts shortly", () => {
    expect(watchThresholds({ turnoverMinor: 4_500_000, turnoverMonthAgoMinor: 0, currency: "EUR", legalName: "X", legal: NO_THRESHOLDS, own })).toEqual([]);
    expect(shortAmount(430_000_000, "NOK", "en-GB", { million: "million" })).toBe("NOK 4.3 million");
    expect(shortAmount(5_000_000, "NOK", "en-GB", { million: "million" })).toBe("NOK 50,000");
    expect(shortAmount(500_000_000, "NOK", "nb-NO", { million: "millioner" })).toBe("NOK 5 millioner");
  });
});
