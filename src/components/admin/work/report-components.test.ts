import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { REPORT_PRINT_CSS, ReportPrintView } from "./report-print";
import { ReportFilters } from "./report-filters";
import { ReportTable } from "./report-table";
import { ReportTotalsView } from "./report-totals";
import { ReportView } from "./report-view";
import { buildPeriodReport, parseReportParams, type PeriodReport, type ReportInput } from "@/lib/work-reports";

/**
 * The report pages draw in every state: an empty period, a busy one, two currencies, a client's name that
 * is not to be trusted, and the print view. Rendered on the server as the pages are; the figures are the
 * pure functions' (tested in `work-reports.test.ts`), these hold that they are put on the page as text.
 */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "");

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const TODAY = "2026-09-29";

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  from: "2026-09-01",
  to: "2026-09-30",
  by: "client",
  fallbackCurrency: "NOK",
  clients: [
    { id: C1, name: "Acme", currency: "NOK", defaultHourlyRateMinor: 100_000 },
    { id: C2, name: "Beta", currency: "EUR", defaultHourlyRateMinor: 5_000 },
  ],
  assignments: [
    { id: A1, clientId: C1, name: "Website", billingType: "hourly", hourlyRateMinor: null },
    { id: A2, clientId: C2, name: "Audit", billingType: "hourly", hourlyRateMinor: null },
  ],
  entries: [
    { assignmentId: A1, workDate: "2026-09-02", minutes: 90, billable: true, prepaidMinutes: 0, invoiceLineId: null },
    { assignmentId: A2, workDate: "2026-09-03", minutes: 30, billable: false, prepaidMinutes: 0, invoiceLineId: null },
  ],
  invoices: [
    {
      id: "i1",
      clientId: C1,
      currency: "NOK",
      issuedOn: "2026-09-10",
      paidMinor: 50_000,
      lines: [{ lineId: "l1", assignmentId: A1, exclMinor: 100_000, inclMinor: 125_000 }],
      credits: [{ lineId: "l1", exclMinor: 20_000, inclMinor: 25_000 }],
    },
  ],
  drafts: [],
  ...over,
});

const params = (over: Record<string, string> = {}) => parseReportParams(over, TODAY);
const view = (report: PeriodReport, over: Record<string, string> = {}) =>
  html(
    createElement(ReportView, {
      storeSlug: "kaffe",
      locale: "en",
      today: TODAY,
      params: params(over),
      report,
      clients: [
        { id: C1, name: "Acme" },
        { id: C2, name: "Beta" },
      ],
    }),
  );

describe("the reports page", () => {
  it("says so when the period has nothing, and still has its totals in the store's currency", () => {
    const text = view(buildPeriodReport(input({ entries: [], invoices: [] })));
    expect(text).toContain("Nothing to report in these days");
    expect(text).not.toContain("<table");
    expect(text).toContain("0m</span> logged");
    expect(text).toMatch(/kr|NOK/);
  });

  it("draws the table with the figures worked out on the server, and a total per currency", () => {
    const text = view(buildPeriodReport(input()));
    expect(text).toContain("<table");
    expect(text).toContain("Acme");
    expect(text).toContain("Beta");
    expect(text).toContain("1h 30m");
    expect(text).toContain("after");
    expect(text).toContain("credited");
    expect(text).toContain("Total (EUR)");
    expect(text).toContain("Total (NOK)");
    expect(text).toContain("never added across currencies");
  });

  it("links to the print view and the downloads with the same settings, and a client's time entries", () => {
    const all = view(buildPeriodReport(input()), { period: "last_month", by: "assignment" });
    expect(all).toContain('href="/admin/kaffe/work/reports/print?period=last_month&amp;by=assignment"');
    expect(all).toContain('href="/admin/kaffe/work/reports/csv?period=last_month&amp;by=assignment"');
    expect(all).not.toContain("Time entries CSV");
    const one = view(buildPeriodReport(input()), { client: C1 });
    expect(one).toContain(`csv?period=this_month&amp;client=${C1}&amp;format=time`);
    expect(one).toContain("Time entries CSV");
  });

  it("offers the presets and the groups, marks the current ones, and keeps the custom days", () => {
    const text = html(
      createElement(ReportFilters, {
        base: "/admin/kaffe/work/reports",
        params: params({ period: "custom", from: "2026-01-05", to: "2026-02-06", by: "assignment" }),
        today: TODAY,
        clients: [{ id: C1, name: "Acme" }],
      }),
    );
    for (const label of ["This month", "Last month", "This quarter", "This year", "By client", "By assignment"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain('value="2026-01-05"');
    expect(text).toContain('value="2026-02-06"');
    expect(text).toContain('name="by" value="assignment"');
    expect(text).toContain("All clients");
    expect((text.match(/aria-current="page"/g) ?? []).length).toBe(2);
    // a preset link carries the rest of the settings and no dates
    expect(text).toContain('href="/admin/kaffe/work/reports?period=last_month&amp;by=assignment"');
  });

  it("explains a custom period it could not use", () => {
    const text = view(buildPeriodReport(input()), { period: "custom", from: "2026-04-01", to: "2026-03-01" });
    expect(text).toContain("The first day is after the last day.");
    expect(text).toContain("Showing this month instead.");
  });

  it("draws a client's name as text, never as markup or a formula link", () => {
    const evil = buildPeriodReport(
      input({
        clients: [{ id: C1, name: '<img src=x onerror="alert(1)">', currency: "NOK", defaultHourlyRateMinor: null }],
      }),
    );
    const text = view(evil);
    expect(text).not.toContain("<img");
    expect(text).toContain("&lt;img");
  });

  it("puts assignments under their client when grouped by assignment", () => {
    const text = html(createElement(ReportTable, { report: buildPeriodReport(input({ by: "assignment" })), locale: "en" }));
    expect(text).toContain("Website");
    expect(text).toContain("Audit");
    expect(text).toContain(">Assignment<");
  });

  it("shows the headline figures once per currency", () => {
    const text = html(createElement(ReportTotalsView, { report: buildPeriodReport(input()), locale: "en" }));
    expect(text).toContain("Invoiced");
    expect(text).toContain("Outstanding");
    expect(text).toContain(">EUR<");
    expect(text).toContain(">NOK<");
  });
});

describe("the print view", () => {
  it("draws the report in landscape with the document's styles and no hooks", () => {
    const text = html(
      createElement(ReportPrintView, { storeName: "Kaffe", locale: "en", today: TODAY, report: buildPeriodReport(input()) }),
    );
    expect(text).toContain("Work report");
    expect(text).toContain("Kaffe");
    expect(text).toContain("Acme");
    expect(text).toContain("Total (NOK)");
    expect(text).toContain("A4 landscape");
    expect(REPORT_PRINT_CSS).not.toMatch(/[>&"']/);
  });

  it("says so for an empty period", () => {
    const text = html(
      createElement(ReportPrintView, {
        storeName: "Kaffe",
        locale: "en",
        today: TODAY,
        report: buildPeriodReport(input({ entries: [], invoices: [] })),
      }),
    );
    expect(text).toContain("Nothing to report in these days.");
    expect(text).not.toContain("<table");
  });
});
