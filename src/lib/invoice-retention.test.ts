import { describe, expect, it } from "vitest";

import { ANONYMISE_FLOOR_YEARS, FALLBACK_RETENTION_YEARS, RETENTION_RULES, SCHEME_RETENTION_YEARS, retentionCutoff, retentionRuleOf } from "./invoice-retention";

describe("how long documents are kept", () => {
  it("is five years in Norway, seven in Sweden, five in Denmark, eight in Germany, ten for any other country", () => {
    expect(["NO", "SE", "DK", "DE", "FI", "", null].map((c) => retentionRuleOf(c).years)).toEqual([5, 7, 5, 8, FALLBACK_RETENTION_YEARS, FALLBACK_RETENTION_YEARS, FALLBACK_RETENTION_YEARS]);
    expect(retentionRuleOf("no").years).toBe(5);
  });

  it("says where each period comes from, how it was read and when, and never claims what was not read", () => {
    for (const [country, rule] of Object.entries(RETENTION_RULES)) {
      expect([country, rule.source.length > 20, /^\d{4}-\d{2}-\d{2}$/.test(rule.checkedOn)]).toEqual([country, true, true]);
    }
    expect(RETENTION_RULES.NO.basis).toBe("read");
    expect(RETENTION_RULES.SE.basis).toBe("snippet");
    expect(RETENTION_RULES.DE.basis).toBe("secondary");
    expect(retentionRuleOf("FI").basis).toBe("fallback");
  });

  it("anonymises from the 1 January after the period's last year, and never sooner than the floor", () => {
    // Issued in 2019 in Norway: kept to the end of 2024, so from 1 January 2025 it may go; the cutoff on a day in 2025 is 1 January 2020.
    expect(retentionCutoff("NO", "2025-03-01")).toBe("2020-01-01");
    expect(retentionCutoff("SE", "2026-10-04")).toBe("2019-01-01");
    expect(retentionCutoff("FI", "2026-10-04")).toBe("2016-01-01");
    expect(ANONYMISE_FLOOR_YEARS).toBe(5);
    for (const c of ["NO", "SE", "DK", "DE", "XX"]) {
      const cutoff = retentionCutoff(c, "2026-10-04");
      expect(Number(cutoff.slice(0, 4))).toBeLessThanOrEqual(2026 - ANONYMISE_FLOOR_YEARS);
    }
  });

  it("keeps the records of a store that uses an OSS or IOSS scheme at least ten years (D161)", () => {
    expect(SCHEME_RETENTION_YEARS).toBe(10);
    expect(retentionCutoff("NO", "2026-10-04", { scheme: true })).toBe("2016-01-01");
    expect(retentionCutoff("NO", "2026-10-04", { scheme: false })).toBe("2021-01-01");
    expect(retentionCutoff("NO", "2026-10-04", {})).toBe("2021-01-01");
    // A country whose own period is longer keeps it; the scheme never shortens anything.
    expect(retentionCutoff("FI", "2026-10-04", { scheme: true })).toBe("2016-01-01");
    for (const c of ["NO", "SE", "DK", "DE", "XX", null]) {
      expect(retentionCutoff(c, "2026-10-04", { scheme: true }) <= retentionCutoff(c, "2026-10-04")).toBe(true);
      expect(Number(retentionCutoff(c, "2026-10-04", { scheme: true }).slice(0, 4))).toBeLessThanOrEqual(2026 - SCHEME_RETENTION_YEARS);
    }
  });
});
