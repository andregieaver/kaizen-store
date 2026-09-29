import { describe, expect, it } from "vitest";

import { todayIn } from "./work-dates";
import {
  allocateMinor,
  buildPeriodReport,
  isEmptyReport,
  parseReportParams,
  periodReportToCsv,
  presetPeriod,
  reportFileName,
  reportQuery,
  rowLabel,
  type ReportInput,
  type ReportInvoice,
} from "./work-reports";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const A3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

describe("periods", () => {
  it("gives whole months, quarters and years for the store's today", () => {
    expect(presetPeriod("this_month", "2026-09-29")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetPeriod("this_month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(presetPeriod("last_month", "2026-09-29")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(presetPeriod("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetPeriod("quarter", "2026-09-29")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(presetPeriod("quarter", "2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(presetPeriod("quarter", "2026-05-31")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(presetPeriod("year", "2026-09-29")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("follows the store's time zone across the days daylight saving moves", () => {
    // 28 Mar 23:30 UTC is already 29 Mar in Oslo (the day the clocks go forward); 31 Mar 22:30 UTC is 1 Apr.
    const late = Date.parse("2026-03-28T23:30:00Z");
    expect(todayIn("Europe/Oslo", late)).toBe("2026-03-29");
    expect(todayIn("UTC", late)).toBe("2026-03-28");
    const endOfMarch = Date.parse("2026-03-31T22:30:00Z");
    expect(presetPeriod("this_month", todayIn("Europe/Oslo", endOfMarch))).toEqual({ from: "2026-04-01", to: "2026-04-30" });
    expect(presetPeriod("this_month", todayIn("UTC", endOfMarch))).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    // Clocks go back on 25 Oct: 24 Oct 22:30 UTC is 00:30 on the 25th in Oslo, and Sydney is a day ahead of UTC.
    expect(todayIn("Europe/Oslo", Date.parse("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    expect(presetPeriod("last_month", todayIn("Australia/Sydney", Date.parse("2026-09-30T14:30:00Z")))).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("reads the settings from the address, falling back to this month", () => {
    const today = "2026-09-29";
    const month = { preset: "this_month", from: "2026-09-01", to: "2026-09-30" };
    expect(parseReportParams({}, today)).toEqual({ period: month, by: "client", clientId: "", problem: null });
    expect(parseReportParams({ period: "last_month", by: "assignment", client: C1.toUpperCase() }, today)).toEqual({
      period: { preset: "last_month", from: "2026-08-01", to: "2026-08-31" },
      by: "assignment",
      clientId: C1,
      problem: null,
    });
    expect(parseReportParams({ period: "custom", from: "2026-01-05", to: "2026-03-10" }, today).period).toEqual({
      preset: "custom",
      from: "2026-01-05",
      to: "2026-03-10",
    });
    // dates alone are a custom period, and a preset ignores stray dates
    expect(parseReportParams({ from: "2026-01-05", to: "2026-01-05" }, today).period.preset).toBe("custom");
    expect(parseReportParams({ period: "year", from: "2020-01-01", to: "2020-01-02" }, today).period.from).toBe("2026-01-01");
    // unusable input says why and falls back
    for (const bad of [
      { period: "custom", from: "2026-02-30", to: "2026-03-01" },
      { period: "custom", from: "2026-04-01", to: "2026-03-01" },
      { period: "custom", from: "2000-01-01", to: "2026-01-01" },
      { period: "custom" },
    ]) {
      const r = parseReportParams(bad, today);
      expect(r.period).toEqual(month);
      expect(r.problem).toEqual(expect.any(String));
    }
    expect(parseReportParams({ period: "nonsense", by: "x", client: "not-a-uuid" }, today)).toEqual({
      period: month,
      by: "client",
      clientId: "",
      problem: null,
    });
    expect(parseReportParams({ by: ["assignment", "client"] }, today).by).toBe("assignment");
  });

  it("writes the settings back, a preset without dates", () => {
    const params = parseReportParams({ period: "last_month", by: "assignment", client: C1 }, "2026-09-29");
    expect(reportQuery(params)).toBe(`?period=last_month&by=assignment&client=${C1}`);
    expect(reportQuery(parseReportParams({}, "2026-09-29"))).toBe("?period=this_month");
    const custom = parseReportParams({ period: "custom", from: "2026-01-01", to: "2026-01-31" }, "2026-09-29");
    expect(reportQuery(custom, { format: "time" })).toBe("?period=custom&from=2026-01-01&to=2026-01-31&format=time");
    expect(parseReportParams(Object.fromEntries(new URLSearchParams(reportQuery(custom))), "2026-09-29")).toEqual(custom);
  });
});

describe("allocateMinor", () => {
  it("shares an amount so the parts always add up", () => {
    expect(allocateMinor(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateMinor(100, [50, 30, 20])).toEqual([50, 30, 20]);
    expect(allocateMinor(1, [0, 3, 3])).toEqual([0, 1, 0]);
    expect(allocateMinor(10, [0, 0])).toEqual([5, 5]);
    expect(allocateMinor(7, [])).toEqual([]);
    expect(allocateMinor(0, [3, 4])).toEqual([0, 0]);
    expect(allocateMinor(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    for (const total of [1, 99, 12_345_678, Number.MAX_SAFE_INTEGER]) {
      const parts = allocateMinor(total, [3, 7, 11, 1234]);
      expect(parts.reduce((s, n) => BigInt(s) + BigInt(n), BigInt(0))).toBe(BigInt(total));
    }
  });

  it("refuses what is not whole", () => {
    expect(() => allocateMinor(1.5, [1])).toThrow(RangeError);
    expect(() => allocateMinor(1, [-1, 2])).toThrow(RangeError);
  });
});

const base = (over: Partial<ReportInput> = {}): ReportInput => ({
  from: "2026-09-01",
  to: "2026-09-30",
  by: "assignment",
  fallbackCurrency: "NOK",
  clients: [
    { id: C1, name: "Acme", currency: "NOK", defaultHourlyRateMinor: 100_000 },
    { id: C2, name: "Beta", currency: "EUR", defaultHourlyRateMinor: null },
  ],
  assignments: [
    { id: A1, clientId: C1, name: "Website", billingType: "hourly", hourlyRateMinor: null },
    { id: A2, clientId: C1, name: "Retainer", billingType: "fixed_fee", hourlyRateMinor: null },
    { id: A3, clientId: C2, name: "Audit", billingType: "hourly", hourlyRateMinor: 5_000 },
  ],
  entries: [],
  invoices: [],
  drafts: [],
  ...over,
});

const invoice = (over: Partial<ReportInvoice> = {}): ReportInvoice => ({
  id: "inv1",
  clientId: C1,
  currency: "NOK",
  issuedOn: "2026-09-10",
  paidMinor: 0,
  lines: [{ lineId: "l1", assignmentId: A1, exclMinor: 100_000, inclMinor: 125_000 }],
  credits: [],
  ...over,
});

describe("the report", () => {
  it("is empty, in the store's own currency, when nothing happened", () => {
    const r = buildPeriodReport(base());
    expect(isEmptyReport(r)).toBe(true);
    expect(r.totals).toHaveLength(1);
    expect(r.totals[0]).toMatchObject({ currency: "NOK", minutes: 0, invoicedMinor: 0, paidMinor: 0, outstandingMinor: 0 });
    expect(r.totalMinutes).toBe(0);
  });

  it("counts the hours of the period, and values unbilled billable time at the rate as an invoice line would", () => {
    const r = buildPeriodReport(
      base({
        entries: [
          { assignmentId: A1, workDate: "2026-09-01", minutes: 90, billable: true, prepaidMinutes: 0, invoiceLineId: null },
          { assignmentId: A1, workDate: "2026-09-30", minutes: 20, billable: true, prepaidMinutes: 0, invoiceLineId: null },
          { assignmentId: A1, workDate: "2026-09-15", minutes: 60, billable: false, prepaidMinutes: 0, invoiceLineId: null },
          { assignmentId: A1, workDate: "2026-09-16", minutes: 60, billable: true, prepaidMinutes: 0, invoiceLineId: "line" },
          { assignmentId: A1, workDate: "2026-09-17", minutes: 60, billable: true, prepaidMinutes: 30, invoiceLineId: null },
          // outside the period, at both ends
          { assignmentId: A1, workDate: "2026-08-31", minutes: 600, billable: true, prepaidMinutes: 0, invoiceLineId: null },
          { assignmentId: A1, workDate: "2026-10-01", minutes: 600, billable: true, prepaidMinutes: 0, invoiceLineId: null },
        ],
      }),
    );
    expect(r.rows).toHaveLength(1);
    // 90 + 20 + 60 + 60 + 60 = 290 logged, 230 billable, unbilled 90 + 20 + 30 = 140 min = 2.33 h at 1000.00 (the client's rate)
    expect(r.rows[0]).toMatchObject({
      assignmentName: "Website",
      currency: "NOK",
      minutes: 290,
      billableMinutes: 230,
      unbilledMinutes: 140,
      unbilledMinor: 233_000,
    });
    expect(r.totalMinutes).toBe(290);
  });

  it("counts a fixed fee once, in the period it is invoiced, and never as unbilled time", () => {
    const fee = invoice({ lines: [{ lineId: "f1", assignmentId: A2, exclMinor: 5_000_000, inclMinor: 6_250_000 }] });
    const september = buildPeriodReport(base({ invoices: [fee] }));
    expect(september.rows.map((r) => [r.assignmentName, r.invoicedMinor])).toEqual([["Retainer", 5_000_000]]);
    // the same invoice does not show in the month after, or the month before, even with time logged on the fee
    const entries = [
      { assignmentId: A2, workDate: "2026-10-05", minutes: 120, billable: true, prepaidMinutes: 0, invoiceLineId: null },
    ];
    const october = buildPeriodReport(base({ from: "2026-10-01", to: "2026-10-31", invoices: [fee], entries }));
    expect(october.rows).toHaveLength(1);
    expect(october.rows[0]).toMatchObject({ assignmentName: "Retainer", invoicedMinor: 0, minutes: 120, unbilledMinor: 0 });
    const august = buildPeriodReport(base({ from: "2026-08-01", to: "2026-08-31", invoices: [fee] }));
    expect(isEmptyReport(august)).toBe(true);
    // over the whole year it is still counted once
    const year = buildPeriodReport(base({ from: "2026-01-01", to: "2026-12-31", invoices: [fee] }));
    expect(year.totals[0].invoicedMinor).toBe(5_000_000);
  });

  it("puts an issued invoice in the period of its issue day, both ends included", () => {
    const on = (day: string) => buildPeriodReport(base({ invoices: [invoice({ issuedOn: day })] })).totals[0].invoicedMinor;
    expect(on("2026-08-31")).toBe(0);
    expect(on("2026-09-01")).toBe(100_000);
    expect(on("2026-09-30")).toBe(100_000);
    expect(on("2026-10-01")).toBe(0);
  });

  it("nets credit notes off what was invoiced, and adds up invoiced, credited, paid and outstanding", () => {
    const inv = invoice({
      paidMinor: 50_000,
      credits: [{ lineId: "l1", exclMinor: 20_000, inclMinor: 25_000 }],
    });
    const r = buildPeriodReport(base({ invoices: [inv] }));
    expect(r.rows[0]).toMatchObject({
      invoicedMinor: 100_000,
      creditedMinor: 20_000,
      netInvoicedMinor: 80_000,
      netInvoicedInclMinor: 100_000,
      paidMinor: 50_000,
      outstandingMinor: 50_000,
    });
    // a fully credited invoice is nothing, and owes nothing
    const voided = buildPeriodReport(
      base({ invoices: [invoice({ credits: [{ lineId: "l1", exclMinor: 100_000, inclMinor: 125_000 }] })] }),
    );
    expect(voided.rows[0]).toMatchObject({ netInvoicedMinor: 0, netInvoicedInclMinor: 0, outstandingMinor: 0, paidMinor: 0 });
  });

  it("shares an invoice's payment over its assignments in proportion, exactly", () => {
    const inv = invoice({
      paidMinor: 100_001,
      lines: [
        { lineId: "a", assignmentId: A1, exclMinor: 100_000, inclMinor: 125_000 },
        { lineId: "b", assignmentId: A2, exclMinor: 300_000, inclMinor: 375_000 },
        { lineId: "c", assignmentId: null, exclMinor: 0, inclMinor: 0 },
      ],
    });
    const r = buildPeriodReport(base({ invoices: [inv] }));
    const by = Object.fromEntries(r.rows.map((x) => [x.assignmentName ?? "(none)", x]));
    expect(by.Website.paidMinor + by.Retainer.paidMinor + by["(none)"].paidMinor).toBe(100_001);
    expect(by.Website.paidMinor).toBe(25_000);
    expect(by.Retainer.paidMinor).toBe(75_001);
    expect(r.totals[0].outstandingMinor).toBe(500_000 - 100_001);
    expect(by.Website.outstandingMinor + by.Retainer.outstandingMinor).toBe(399_999);
    expect(rowLabel(by["(none)"], "assignment")).toBe("Other lines (no assignment)");
    // by client the same money is one row
    const byClient = buildPeriodReport(base({ by: "client", invoices: [inv] }));
    expect(byClient.rows).toHaveLength(1);
    expect(byClient.rows[0]).toMatchObject({ clientName: "Acme", assignmentId: null, paidMinor: 100_001, invoicedMinor: 400_000 });
  });

  it("keeps an overpayment as paid and owes nothing", () => {
    const r = buildPeriodReport(base({ invoices: [invoice({ paidMinor: 200_000 })] }));
    expect(r.rows[0]).toMatchObject({ paidMinor: 200_000, outstandingMinor: 0 });
  });

  it("shows drafts apart, by the day they were made, and never as invoiced", () => {
    const draft = {
      id: "d1",
      clientId: C1,
      currency: "NOK",
      createdOn: "2026-09-20",
      lines: [{ assignmentId: A1, exclMinor: 40_000 }],
    };
    const r = buildPeriodReport(base({ drafts: [draft, { ...draft, id: "d2", createdOn: "2026-10-01" }] }));
    expect(r.rows[0]).toMatchObject({ draftMinor: 40_000, invoicedMinor: 0, outstandingMinor: 0 });
    expect(r.totals[0].draftMinor).toBe(40_000);
  });

  it("keeps currencies apart: a client billed in another currency gets its own row and total", () => {
    const r = buildPeriodReport(
      base({
        by: "client",
        entries: [{ assignmentId: A1, workDate: "2026-09-02", minutes: 60, billable: true, prepaidMinutes: 0, invoiceLineId: null }],
        invoices: [
          invoice({ id: "i1", currency: "NOK" }),
          invoice({ id: "i2", currency: "EUR", lines: [{ lineId: "x", assignmentId: A1, exclMinor: 7_000, inclMinor: 7_000 }] }),
          invoice({ id: "i3", clientId: C2, currency: "EUR", lines: [{ lineId: "y", assignmentId: A3, exclMinor: 1_000, inclMinor: 1_250 }] }),
        ],
      }),
    );
    expect(r.rows.map((x) => `${x.clientName} ${x.currency}`)).toEqual(["Acme EUR", "Acme NOK", "Beta EUR"]);
    expect(r.totals.map((t) => [t.currency, t.invoicedMinor])).toEqual([
      ["EUR", 8_000],
      ["NOK", 100_000],
    ]);
    // hours are counted once, in the client's own currency
    expect(r.totalMinutes).toBe(60);
    expect(r.totals.find((t) => t.currency === "NOK")!.minutes).toBe(60);
  });

  it("sorts by client then assignment", () => {
    const r = buildPeriodReport(
      base({
        invoices: [
          invoice({
            lines: [
              { lineId: "1", assignmentId: A2, exclMinor: 1, inclMinor: 1 },
              { lineId: "2", assignmentId: A1, exclMinor: 1, inclMinor: 1 },
            ],
          }),
          invoice({ id: "i2", clientId: C2, currency: "EUR", lines: [{ lineId: "3", assignmentId: A3, exclMinor: 1, inclMinor: 1 }] }),
        ],
      }),
    );
    expect(r.rows.map((x) => x.assignmentName)).toEqual(["Retainer", "Website", "Audit"]);
  });
});

describe("the CSV", () => {
  it("has a header block, plain decimals and a total per currency", () => {
    const csv = periodReportToCsv(
      buildPeriodReport(
        base({
          entries: [{ assignmentId: A1, workDate: "2026-09-02", minutes: 90, billable: true, prepaidMinutes: 0, invoiceLineId: null }],
          invoices: [invoice({ paidMinor: 25_000 })],
        }),
      ),
    );
    const lines = csv.trimEnd().split("\r\n");
    expect(lines.slice(0, 5)).toEqual(["Report,Work report", "From,2026-09-01", "To,2026-09-30", "Grouped by,assignment", ""]);
    expect(lines[5]).toContain("Net invoiced excl. VAT");
    expect(lines[6]).toBe("Acme,Website,hourly,NOK,1.50,1.50,1.50,1500.00,0.00,1000.00,0.00,1000.00,1250.00,250.00,1000.00");
    expect(lines[8]).toBe("Total,,,NOK,1.50,1.50,1.50,1500.00,0.00,1000.00,0.00,1000.00,1250.00,250.00,1000.00");
  });

  it("writes text a spreadsheet would run as a formula as plain text", () => {
    const csv = periodReportToCsv(
      buildPeriodReport(
        base({
          clients: [{ id: C1, name: '=HYPERLINK("http://evil","x")', currency: "NOK", defaultHourlyRateMinor: null }],
          assignments: [{ id: A1, clientId: C1, name: "+cmd|' /C calc'!A0", billingType: "hourly", hourlyRateMinor: null }],
          invoices: [invoice()],
        }),
      ),
    );
    const row = csv.trimEnd().split("\r\n")[6];
    expect(row.startsWith(`"'=HYPERLINK(`)).toBe(true);
    expect(row).toContain(",'+cmd|");
    expect(row).not.toMatch(/(^|,)[=+@]/);
  });

  it("is an empty report with zero totals and a safe file name", () => {
    const empty = buildPeriodReport(base());
    expect(periodReportToCsv(empty).trimEnd().split("\r\n").pop()).toBe("Total,,,NOK,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00");
    expect(reportFileName("kaffe", empty)).toBe("work-report-kaffe-assignment-2026-09-01-2026-09-30.csv");
    expect(reportFileName("../x\"y", empty)).not.toMatch(/["/\\]/);
  });
});
