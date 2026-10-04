import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AUDIT_RETENTION_MONTHS } from "./audit";
import { RETENTION_MONTHS } from "./visit-record";
import { EVENT_DAYS } from "./recommendations";
import {
  ANONYMISE_FLOOR_YEARS,
  CEILING_RETENTION_MONTHS,
  FALLBACK_RETENTION_MONTHS,
  RETENTION_BASES,
  RETENTION_KINDS,
  RETENTION_SEED,
  addDays,
  addMonths,
  cutoffInstant,
  describePeriod,
  fallbackPeriod,
  inForce,
  keptUntil,
  periodCutoff,
  periodFor,
  retentionCutoff,
  ruleFor,
  ruleProblem,
  type RetentionRuleRow,
} from "./retention";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const constantIn = (file: string, name: string): number => {
  const m = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(read(file));
  if (!m) throw new Error(`${name} not found in ${file}`);
  return Number(m[1]);
};

describe("the seed of the retention schedule", () => {
  it("has a row for every kind, with where it comes from and when it was checked, all unverified", () => {
    for (const kind of RETENTION_KINDS) expect(RETENTION_SEED.some((r) => r.kind === kind), kind).toBe(true);
    for (const row of RETENTION_SEED) {
      expect([row.kind, row.country, row.source.length >= 8, /^\d{4}-\d{2}-\d{2}$/.test(row.checkedOn), RETENTION_BASES.includes(row.basis), row.verifiedAt ?? null]).toEqual([
        row.kind,
        row.country,
        true,
        true,
        true,
        null,
      ]);
    }
  });

  it("has Norway at 5, Sweden at 7, Denmark at 5, Germany at 8 and ten years for any other country, counted from the end of the year", () => {
    const years = (c: string | null) => periodFor("bookkeeping", c, "2026-10-04").periodValue / 12;
    expect(["NO", "SE", "DK", "DE", "FI", null].map(years)).toEqual([5, 7, 5, 8, 10, 10]);
    expect(periodFor("bookkeeping", "NO", "2026-10-04").countsFrom).toBe("end_of_year");
    expect(periodFor("host_bookkeeping", "NO", "2026-10-04").periodValue).toBe(120);
  });

  it("never claims a statute for a period nobody read: the basis says what was read", () => {
    const basis = (c: string | null) => ruleFor("bookkeeping", c, "2026-10-04")?.basis;
    expect(["NO", "SE", "DK", "DE", "FI"].map(basis)).toEqual(["read", "read", "snippet", "secondary", "fallback"]);
    for (const row of RETENTION_SEED.filter((r) => !["bookkeeping", "host_bookkeeping"].includes(r.kind))) expect(row.basis, row.kind).toBe("policy");
  });

  it("holds a bookkeeping period to whole years from the end of the year, and a year-end period only to months in twelves", () => {
    for (const row of RETENTION_SEED) {
      if (row.countsFrom === "end_of_year") expect([row.kind, row.periodUnit, row.periodValue % 12]).toEqual([row.kind, "months", 0]);
    }
  });

  it("holds the existing pruners' periods equal to the seeded rules, so the two cannot drift", () => {
    const rule = (kind: string) => RETENTION_SEED.find((r) => r.kind === kind && r.country === null)!;
    expect(rule("search_queries").periodValue).toBe(constantIn("src/server/search.ts", "SEARCH_LOG_DAYS"));
    expect(rule("visits").periodValue).toBe(RETENTION_MONTHS);
    expect(rule("audit_log").periodValue).toBe(AUDIT_RETENTION_MONTHS);
    expect(rule("recommendation_events").periodValue).toBe(EVENT_DAYS);
    expect(rule("ai_usage").periodValue).toBe(constantIn("src/server/ai-usage.ts", "USAGE_KEEP_DAYS"));
    expect(rule("integration_deliveries").periodValue).toBe(constantIn("src/server/integrations.ts", "KEEP_DAYS"));
    expect(rule("form_submissions").periodValue).toBe(30);
    expect(read("src/server/forms.ts")).toContain("interval '30 days'");
    expect(rule("consents").periodValue).toBe(12);
  });
});

describe("which rule applies", () => {
  const own: RetentionRuleRow = { ...RETENTION_SEED.find((r) => r.kind === "bookkeeping" && r.country === "NO")!, periodValue: 72, validFrom: "2030-01-01" };
  const closed: RetentionRuleRow = { ...RETENTION_SEED.find((r) => r.kind === "bookkeeping" && r.country === "NO")!, validTo: "2030-01-01" };

  it("takes the country's own row in force on the day, else the default, else the safe side", () => {
    const rules = [closed, own, ...RETENTION_SEED.filter((r) => !(r.kind === "bookkeeping" && r.country === "NO"))];
    expect(periodFor("bookkeeping", "NO", "2029-12-31", rules).periodValue).toBe(60);
    expect(periodFor("bookkeeping", "NO", "2030-01-01", rules).periodValue).toBe(72);
    expect(periodFor("bookkeeping", "no", "2031-06-01", rules).periodValue).toBe(72);
    expect(periodFor("bookkeeping", "FI", "2031-06-01", rules).periodValue).toBe(120);
    // An empty table never means keep nothing or delete everything: ten years.
    expect(periodFor("bookkeeping", "NO", "2026-10-04", [])).toEqual({ periodValue: FALLBACK_RETENTION_MONTHS, periodUnit: "months", countsFrom: "end_of_year" });
    expect(fallbackPeriod("carts")).toEqual({ periodValue: FALLBACK_RETENTION_MONTHS, periodUnit: "months", countsFrom: "event" });
    expect(retentionCutoff("NO", "2026-10-04", [])).toBe("2016-01-01");
  });

  it("treats a rule's end day as the first day it no longer applies", () => {
    expect(inForce({ validFrom: "2020-01-01", validTo: "2021-01-01" }, "2020-12-31")).toBe(true);
    expect(inForce({ validFrom: "2020-01-01", validTo: "2021-01-01" }, "2021-01-01")).toBe(false);
    expect(inForce({ validFrom: "2020-01-01", validTo: null }, "2019-12-31")).toBe(false);
  });
});

describe("the dates a period gives", () => {
  it("counts a bookkeeping period from the end of the calendar year: a sale of year Y goes on 1 January of Y + years + 1", () => {
    // Norway, 5 years: a sale in 2020 is kept to the end of 2025, so on 1 January 2026 it may go.
    expect(retentionCutoff("NO", "2025-12-31")).toBe("2020-01-01");
    expect(retentionCutoff("NO", "2026-01-01")).toBe("2021-01-01");
    expect(retentionCutoff("SE", "2026-10-04")).toBe("2019-01-01");
    expect(retentionCutoff("DK", "2026-10-04")).toBe("2021-01-01");
    expect(retentionCutoff("DE", "2026-10-04")).toBe("2018-01-01");
    expect(retentionCutoff("XX", "2026-10-04")).toBe("2016-01-01");
    // The anchor day 2020-12-31 is due on 2026-01-01 in Norway and not the day before.
    expect("2020-12-31" < retentionCutoff("NO", "2025-12-31")).toBe(false);
    expect("2020-12-31" < retentionCutoff("NO", "2026-01-01")).toBe(true);
    expect(keptUntil("2020-12-31", periodFor("bookkeeping", "NO", "2026-10-04"))).toBe("2026-01-01");
    expect(keptUntil("2020-01-01", periodFor("bookkeeping", "SE", "2026-10-04"))).toBe("2028-01-01");
  });

  it("never gives a cutoff younger than the floor, even for a wrong rule", () => {
    const wrong: RetentionRuleRow = { ...RETENTION_SEED.find((r) => r.kind === "bookkeeping" && r.country === "NO")!, periodValue: 12, validFrom: "2027-01-01" };
    const cutoff = retentionCutoff("NO", "2030-06-01", [wrong]);
    expect(Number(cutoff.slice(0, 4))).toBeLessThanOrEqual(2030 - ANONYMISE_FLOOR_YEARS);
    expect(keptUntil("2030-06-01", { periodValue: 12, periodUnit: "months", countsFrom: "end_of_year" })).toBe("2036-01-01");
  });

  it("counts an event period in days or months from today, clamping the month's end", () => {
    expect(periodCutoff({ periodValue: 30, periodUnit: "days", countsFrom: "event" }, "2026-03-01")).toBe("2026-01-30");
    expect(periodCutoff({ periodValue: 12, periodUnit: "months", countsFrom: "event" }, "2026-02-28")).toBe("2025-02-28");
    expect(periodCutoff({ periodValue: 1, periodUnit: "months", countsFrom: "event" }, "2026-03-31")).toBe("2026-02-28");
    expect(periodCutoff({ periodValue: 24, periodUnit: "months", countsFrom: "event" }, "2028-02-29")).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -2)).toBe("2025-11-15");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("gives the instant before which a timestamp row is past its period", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    expect(cutoffInstant({ periodValue: 7, periodUnit: "days", countsFrom: "event" }, now).toISOString()).toBe("2026-09-27T12:00:00.000Z");
    expect(cutoffInstant({ periodValue: 12, periodUnit: "months", countsFrom: "event" }, now).toISOString()).toBe("2025-10-04T12:00:00.000Z");
    expect(cutoffInstant({ periodValue: 1, periodUnit: "months", countsFrom: "event" }, new Date("2026-03-31T00:00:00.000Z")).toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("says a period in words", () => {
    expect(describePeriod({ periodValue: 60, periodUnit: "months", countsFrom: "end_of_year" })).toBe("5 years from the end of the calendar year");
    expect(describePeriod({ periodValue: 12, periodUnit: "months", countsFrom: "event" })).toBe("1 year");
    expect(describePeriod({ periodValue: 30, periodUnit: "days", countsFrom: "event" })).toBe("30 days");
    expect(describePeriod({ periodValue: 1, periodUnit: "days", countsFrom: "event" })).toBe("1 day");
    expect(describePeriod({ periodValue: 18, periodUnit: "months", countsFrom: "event" })).toBe("18 months");
  });
});

describe("what a platform admin may change", () => {
  it("refuses a bookkeeping period under five years, a year-end period that is not whole years, and anything above fifty years", () => {
    const p = (periodValue: number, periodUnit: "days" | "months", countsFrom: "event" | "end_of_year") => ({ periodValue, periodUnit, countsFrom });
    expect(ruleProblem("bookkeeping", p(59, "months", "end_of_year"))).toBe("year_unit");
    expect(ruleProblem("bookkeeping", p(48, "months", "end_of_year"))).toBe("floor");
    expect(ruleProblem("bookkeeping", p(60, "months", "end_of_year"))).toBeNull();
    expect(ruleProblem("host_bookkeeping", p(30, "days", "event"))).toBe("floor");
    expect(ruleProblem("carts", p(1, "days", "event"))).toBeNull();
    expect(ruleProblem("carts", p(0, "days", "event"))).toBe("period");
    expect(ruleProblem("carts", p(CEILING_RETENTION_MONTHS + 1, "months", "event"))).toBe("ceiling");
    expect(ruleProblem("carts", p(12, "days", "end_of_year"))).toBe("year_unit");
  });
});
