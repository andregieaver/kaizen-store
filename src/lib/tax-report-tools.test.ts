import { describe, expect, it } from "vitest";

import { NOT_A_RETURN, resolveReturnPeriod, resolveVatRange } from "./tax-report-tools";

const ok = (r: ReturnType<typeof resolveVatRange>) => {
  if (!r.ok) throw new Error(r.problem);
  return r;
};

describe("the periods of the VAT report tool", () => {
  it("names last month, this month so far, the quarters and the years in the store's own days (to is exclusive)", () => {
    const today = "2026-10-04";
    expect(ok(resolveVatRange({ period: "last_month" }, today)).range).toEqual({ from: "2026-09-01", to: "2026-10-01" });
    expect(ok(resolveVatRange({ period: "month" }, today)).range).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    expect(ok(resolveVatRange({ period: "last_quarter" }, today)).range).toEqual({ from: "2026-07-01", to: "2026-10-01" });
    expect(ok(resolveVatRange({ period: "quarter" }, today)).range).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    expect(ok(resolveVatRange({ period: "last_year" }, today)).range).toEqual({ from: "2025-01-01", to: "2026-01-01" });
    expect(ok(resolveVatRange({ period: "year" }, today)).range).toEqual({ from: "2026-01-01", to: "2026-10-05" });
    expect(ok(resolveVatRange({ period: "last_month" }, "2027-01-15")).range).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });

  it("takes two typed days, the last included, in place of the name", () => {
    const r = ok(resolveVatRange({ period: "last_month", from: "2026-07-01", to: "2026-09-30" }, "2026-10-04"));
    expect(r.range).toEqual({ from: "2026-07-01", to: "2026-10-01" });
    expect(r.label).toContain("1 July 2026 to 30 September 2026");
  });

  it("refuses half a range, a day that is not one, a backwards range and one over 800 days, in words", () => {
    for (const input of [
      { period: "month" as const, from: "2026-07-01" },
      { period: "month" as const, from: "2026-02-30", to: "2026-03-01" },
      { period: "month" as const, from: "2026-09-02", to: "2026-09-01" },
      { period: "month" as const, from: "2023-01-01", to: "2026-01-01" },
    ]) {
      const r = resolveVatRange(input, "2026-10-04");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problem.length).toBeGreaterThan(10);
    }
  });
});

describe("the period of a return", () => {
  it("is the last ended quarter or month when none is named", () => {
    expect(resolveReturnPeriod("oss", undefined, "2026-10-04")).toMatchObject({ ok: true, period: { key: "2026-Q3" } });
    expect(resolveReturnPeriod("ioss", undefined, "2026-10-04")).toMatchObject({ ok: true, period: { key: "2026-09" } });
    expect(resolveReturnPeriod("ioss", undefined, "2026-01-10")).toMatchObject({ ok: true, period: { key: "2025-12" } });
  });

  it("takes a key of the scheme's own kind and refuses the other, with the form to write", () => {
    expect(resolveReturnPeriod("oss", "2026-Q2", "2026-10-04")).toMatchObject({ ok: true, period: { key: "2026-Q2", kind: "quarter" } });
    expect(resolveReturnPeriod("ioss", "2026-08", "2026-10-04")).toMatchObject({ ok: true, period: { key: "2026-08", kind: "month" } });
    expect(resolveReturnPeriod("oss", "2026-09", "2026-10-04")).toMatchObject({ ok: false, problem: expect.stringContaining("2026-Q3") });
    expect(resolveReturnPeriod("ioss", "2026-Q3", "2026-10-04")).toMatchObject({ ok: false, problem: expect.stringContaining("2026-09") });
    expect(resolveReturnPeriod("oss", "2026-Q5", "2026-10-04").ok).toBe(false);
  });
});

describe("the sentence under every figure", () => {
  it("says it is not a return, nothing is filed and it is not advice", () => {
    expect(NOT_A_RETURN).toMatch(/not a tax return/);
    expect(NOT_A_RETURN).toMatch(/files nothing/);
    expect(NOT_A_RETURN).toMatch(/not tax or accounting advice/);
  });
});
