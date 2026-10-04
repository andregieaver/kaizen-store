import { describe, expect, it } from "vitest";

import { EXPORT_PROBLEMS, exportBackHref, exportProblemOf, parseExportForm, parseTaxQuery, periodOptions, taxHref } from "./tax-admin";

const form = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

describe("parseTaxQuery", () => {
  it("opens the VAT view on the last completed quarter and month in filing mode when the address says nothing", () => {
    const q = parseTaxQuery({}, "2026-10-04");
    expect(q.view).toBe("vat");
    expect(q.quarter.key).toBe("2026-Q3");
    expect(q.month.key).toBe("2026-09");
    expect(q.mode).toBe("filing");
  });

  it("reads a view, a quarter, a month and a mode, and falls back for anything else", () => {
    const q = parseTaxQuery({ view: "oss", quarter: "2026-Q2", month: "2026-06", mode: "books" }, "2026-10-04");
    expect(q).toMatchObject({ view: "oss", mode: "books" });
    expect(q.quarter.key).toBe("2026-Q2");
    expect(q.month.key).toBe("2026-06");
    const bad = parseTaxQuery({ view: "<script>", quarter: "2026-Q9", month: "nope", mode: "x" }, "2026-10-04");
    expect(bad.view).toBe("vat");
    expect(bad.quarter.key).toBe("2026-Q3");
    expect(bad.month.key).toBe("2026-09");
    expect(bad.mode).toBe("filing");
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseTaxQuery({ view: ["ioss", "oss"] }, "2026-10-04").view).toBe("ioss");
  });

  it("allows the running quarter but not one that has not begun, and nothing before the schemes began", () => {
    expect(parseTaxQuery({ quarter: "2026-Q4" }, "2026-10-04").quarter.key).toBe("2026-Q4");
    expect(parseTaxQuery({ quarter: "2027-Q1" }, "2026-10-04").quarter.key).toBe("2026-Q3");
    expect(parseTaxQuery({ quarter: "2021-Q2" }, "2026-10-04").quarter.key).toBe("2026-Q3");
    expect(parseTaxQuery({ quarter: "2021-Q3" }, "2026-10-04").quarter.key).toBe("2021-Q3");
    expect(parseTaxQuery({ month: "2021-06" }, "2026-10-04").month.key).toBe("2026-09");
    expect(parseTaxQuery({ month: "2026-11" }, "2026-10-04").month.key).toBe("2026-09");
  });
});

describe("periodOptions", () => {
  it("lists the running quarter and the eleven before it, newest first", () => {
    const options = periodOptions("quarter", "2026-10-04");
    expect(options).toHaveLength(12);
    expect(options[0]).toEqual({ key: "2026-Q4", label: "Q4 2026" });
    expect(options[1]).toEqual({ key: "2026-Q3", label: "Q3 2026" });
    expect(options[11].key).toBe("2024-Q1");
  });

  it("lists months and stops at the first month of the schemes", () => {
    const months = periodOptions("month", "2026-10-04");
    expect(months[0]).toEqual({ key: "2026-10", label: "October 2026" });
    expect(months).toHaveLength(24);
    const early = periodOptions("month", "2021-09-10");
    expect(early.map((o) => o.key)).toEqual(["2021-09", "2021-08", "2021-07"]);
  });

  it("never offers a quarter before 2021 Q3", () => {
    expect(periodOptions("quarter", "2022-02-01").map((o) => o.key)).toEqual(["2022-Q1", "2021-Q4", "2021-Q3"]);
  });
});

describe("taxHref", () => {
  it("leaves out what is the default", () => {
    expect(taxHref("/admin/s", { view: "vat" })).toBe("/admin/s/analytics/tax");
    expect(taxHref("/admin/s", { view: "oss", quarter: "2026-Q3", mode: "filing" })).toBe("/admin/s/analytics/tax?view=oss&quarter=2026-Q3");
    expect(taxHref("/admin/s", { view: "ioss", month: "2026-09", mode: "books" })).toBe("/admin/s/analytics/tax?view=ioss&month=2026-09&mode=books");
  });

  it("keeps the period of the VAT view and adds extra parameters", () => {
    expect(taxHref("/admin/s", { view: "vat" }, { period: "custom", from: "2026-01-01", to: "2026-03-31" })).toBe("/admin/s/analytics/tax?period=custom&from=2026-01-01&to=2026-03-31");
  });
});

describe("exportProblemOf", () => {
  it("answers only with a fixed sentence it knows, never with text from the address", () => {
    expect(exportProblemOf("incomplete")).toBe(EXPORT_PROBLEMS.incomplete);
    expect(exportProblemOf("forbidden")).toBe("Exports need the analytics role with write access.");
    expect(exportProblemOf("<b>hello</b>")).toBeNull();
    expect(exportProblemOf("constructor")).toBeNull();
    expect(exportProblemOf("__proto__")).toBeNull();
    expect(exportProblemOf(undefined)).toBeNull();
  });
});

describe("parseExportForm", () => {
  it("reads a range as two days, the last included, and makes the end exclusive", () => {
    const r = parseExportForm(form({ kind: "vat", from: "2026-07-01", last: "2026-09-30" }));
    expect(r).toEqual({ ok: true, kind: "vat", range: { from: "2026-07-01", to: "2026-10-01" }, last: "2026-09-30" });
    expect(parseExportForm(form({ kind: "reconciliation", from: "2026-09-30", last: "2026-09-30" }))).toMatchObject({ ok: true, kind: "reconciliation", range: { from: "2026-09-30", to: "2026-10-01" } });
  });

  it("refuses a range in the wrong order, of more than 800 days, or that is not two real days", () => {
    for (const values of [
      { kind: "vat", from: "2026-10-10", last: "2026-10-01" },
      { kind: "vat", from: "2020-01-01", last: "2026-10-01" },
      { kind: "vat", from: "2026-02-30", last: "2026-03-01" },
      { kind: "vat", from: "", last: "" },
      { kind: "vat" },
    ] as Record<string, string>[]) {
      expect(parseExportForm(form(values))).toEqual({ ok: false, problem: "period" });
    }
  });

  it("reads a quarter for OSS and a month for IOSS, with the mode and whether it is the conversion detail", () => {
    const oss = parseExportForm(form({ kind: "oss", period: "2026-Q3", mode: "books" }));
    expect(oss).toMatchObject({ ok: true, kind: "oss", scheme: "oss", mode: "books", detail: false });
    const detail = parseExportForm(form({ kind: "ioss_detail", period: "2026-09" }));
    expect(detail).toMatchObject({ ok: true, kind: "ioss_detail", scheme: "ioss", mode: "filing", detail: true });
    if (detail.ok && "period" in detail) expect(detail.period.key).toBe("2026-09");
  });

  it("refuses an OSS export for a month, an IOSS export for a quarter, and a kind it does not know", () => {
    expect(parseExportForm(form({ kind: "oss", period: "2026-09" }))).toEqual({ ok: false, problem: "period" });
    expect(parseExportForm(form({ kind: "ioss", period: "2026-Q3" }))).toEqual({ ok: false, problem: "period" });
    expect(parseExportForm(form({ kind: "everything", period: "2026-Q3" }))).toEqual({ ok: false, problem: "period" });
  });
});

describe("exportBackHref", () => {
  it("goes back to the view and the period the export was asked from, with the problem", () => {
    const oss = parseExportForm(form({ kind: "oss", period: "2026-Q3", mode: "books" }));
    expect(exportBackHref("/admin/s", oss, "incomplete")).toBe("/admin/s/analytics/tax?view=oss&quarter=2026-Q3&mode=books&export=incomplete");
    const ioss = parseExportForm(form({ kind: "ioss", period: "2026-09" }));
    expect(exportBackHref("/admin/s", ioss, "failed")).toBe("/admin/s/analytics/tax?view=ioss&month=2026-09&export=failed");
    const vat = parseExportForm(form({ kind: "vat", from: "2026-07-01", last: "2026-09-30" }));
    expect(exportBackHref("/admin/s", vat, "failed")).toBe("/admin/s/analytics/tax?period=custom&from=2026-07-01&to=2026-09-30&export=failed");
    expect(exportBackHref("/admin/s", { ok: false, problem: "period" }, "period")).toBe("/admin/s/analytics/tax?export=period");
  });
});
