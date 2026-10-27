import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { customPeriod } from "@/lib/analytics-period";
import { customReportsEn } from "@/lib/admin-messages/custom-reports.en";
import { customReportsNb } from "@/lib/admin-messages/custom-reports.nb";
import { blankSpec, type ReportSpec } from "@/lib/report-catalogue";
import type { ReportResult } from "@/server/report-query";

import { ReportView } from "./report-view";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/[  ]/g, " ");

const spec = (o: Partial<ReportSpec>): ReportSpec => ({ ...blankSpec(), chart: "table", ...o });

const result = (o: Partial<ReportResult> & { spec: ReportSpec }): ReportResult => ({
  currency: "NOK",
  period: customPeriod("2026-09-01", "2026-09-07"),
  comparison: null,
  columns: o.spec.metrics.map((metric) => ({ metric, addsUp: true })),
  rows: [],
  totals: { values: {}, previous: null, coverage: null },
  unconverted: 0,
  missingCurrencies: [],
  hiddenRows: 0,
  linesOnly: false,
  ...o,
});

/** A report's result (D345): the rows, the rest row and the totals, and what the figures rest on, said, never hidden. */
describe("a report's result", () => {
  it("draws the rows, the rest row last and the totals, amounts in the main currency", () => {
    const r = result({
      spec: spec({ metrics: ["net_sales", "units"], dimensions: ["product"] }),
      rows: [
        { keys: ["p1"], values: { net_sales: 94_400, units: 4 }, previous: null, coverage: null, rest: false },
        { keys: ["__rest"], values: { net_sales: 13_920, units: null }, previous: null, coverage: null, rest: true },
      ],
      totals: { values: { net_sales: 108_320, units: 4 }, previous: null, coverage: null },
    });
    const out = html(h(ReportView, { report: r, labels: [["Mug"], ["Shipping and other order amounts"]], words: customReportsEn, locale: "en-GB" }));
    expect(out).toContain("Mug");
    expect(out).toMatch(/944\.00/);
    expect(out).toContain('data-rest="true"');
    expect(out).toContain("Total");
    expect(out).toMatch(/1,083\.20|1 083\.20/);
  });

  it("says a column does not add up, rows left out, orders left out for want of a rate, and profit that is not known", () => {
    const r = result({
      spec: spec({ metrics: ["orders", "gross_profit"], dimensions: ["product"] }),
      columns: [
        { metric: "orders", addsUp: false },
        { metric: "gross_profit", addsUp: true },
      ],
      rows: [{ keys: ["p1"], values: { orders: 3, gross_profit: null }, previous: null, coverage: 0.1, rest: false }],
      totals: { values: { orders: 3, gross_profit: null }, previous: null, coverage: 0.1 },
      unconverted: 2,
      missingCurrencies: ["SEK"],
      hiddenRows: 5,
    });
    const out = html(h(ReportView, { report: r, labels: [["Mug"]], words: customReportsEn, locale: "en-GB" }));
    expect(out).toContain(customReportsEn.result.doesNotAddUp);
    expect(out).toContain("5 more rows are not shown");
    expect(out).toContain("2 orders or refunds in SEK are left out");
    expect(out).toContain(customReportsEn.result.noProfit);
    expect(out).toContain(customReportsEn.result.noProfitHelp);
  });

  it("shows the comparison beside each figure, in Norwegian too", () => {
    const r = result({
      spec: spec({ metrics: ["orders"], dimensions: ["market"] }),
      comparison: customPeriod("2026-08-25", "2026-08-31"),
      rows: [{ keys: ["NO"], values: { orders: 4 }, previous: { orders: 2 }, coverage: null, rest: false }],
      totals: { values: { orders: 4 }, previous: { orders: 2 }, coverage: null },
    });
    const out = html(h(ReportView, { report: r, labels: [["Norge"]], words: customReportsNb, locale: "nb-NO" }));
    expect(out).toContain("Ordrer · Før");
    expect(out).toContain("Sum");
    expect(out).toMatch(/\+100/);
  });
});
