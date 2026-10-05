import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { queryRecord, queryText } from "@/lib/analytics-export";

import { HorizontalBars, LineChart } from "./charts";
import { DataTable, type Column } from "./data-table";
import { ExportButton, ExportScope } from "./export-scope";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/**
 * The Download CSV button of the analytics tables (D165, `docs/wave-2-data.md` 2.8): a POST form to the export route with the table's id and the
 * page's own address parameters, drawn only inside a scope for a member who may export, and never as a link.
 */

type Row = { id: string; name: string };
const columns: Column<Row>[] = [{ key: "name", label: "Product", cell: (r) => r.name }];
const rows: Row[] = [{ id: "a", name: "Shoes" }];
const table = (props: Record<string, unknown> = {}) => h(DataTable<Row>, { caption: "Products", columns, rows, rowKey: (r: Row) => r.id, exportId: "products.table", ...props });
const scoped = (child: Parameters<typeof h>[0] | ReturnType<typeof h>, scope: { owner?: boolean; canExport?: boolean; query?: string } = {}) =>
  html(h(ExportScope, { base: "/admin/shop", query: scope.query ?? "period=7d&compare=previous", owner: scope.owner ?? true, canExport: scope.canExport ?? true, children: child as never }));

describe("the Download CSV button", () => {
  it("is a POST form to the store's analytics export with the table and the page's parameters, not a link", () => {
    const out = scoped(table());
    expect(out).toMatch(/<form [^>]*action="\/admin\/shop\/analytics\/export"[^>]*method="post"/);
    expect(out).toContain('<input type="hidden" name="table" value="products.table"/>');
    expect(out).toContain('<input type="hidden" name="query" value="period=7d&compare=previous"/>');
    expect(out).toContain("Download CSV");
    expect(out).toContain("for: Products with revenue");
    expect(out).not.toMatch(/<a [^>]*export/);
  });

  it("is drawn nowhere without a scope, and not for a member who may only read", () => {
    expect(html(table())).not.toContain("Download CSV");
    expect(scoped(table(), { canExport: false })).not.toContain("Download CSV");
  });

  it("leaves the owner's tables to the owner: the top customers and the targets", () => {
    expect(scoped(h(ExportButton, { exportId: "customers.top" }), { owner: false })).not.toContain("Download CSV");
    expect(scoped(h(ExportButton, { exportId: "customers.top" }), { owner: true })).toContain("Download CSV");
    expect(scoped(h(ExportButton, { exportId: "settings.targets" }), { owner: false })).not.toContain("Download CSV");
    expect(scoped(h(ExportButton, { exportId: "products.table" }), { owner: false })).toContain("Download CSV");
  });

  it("says what the page left out, so the file never states more than the page", () => {
    const out = scoped(table({ exportLeftOut: { orders: 3, currencies: ["SEK"] } }));
    expect(out).toContain("Download CSV: 3 orders in SEK left out, as on this page");
  });

  it("has no button for a table with no rows, and none for a table with no id", () => {
    expect(scoped(table({ rows: [] }))).not.toContain("Download CSV");
    expect(scoped(table({ exportId: undefined }))).not.toContain("Download CSV");
  });

  it("is under a chart's data too, but not under a chart that has nothing to draw", () => {
    const bars = scoped(h(HorizontalBars, { label: "Top", rows: [{ label: "Shoes", value: 5, valueText: "5" }], exportId: "overview.top_revenue" }));
    expect(bars).toContain('name="table" value="overview.top_revenue"');
    const empty = scoped(h(HorizontalBars, { label: "Top", rows: [], exportId: "overview.top_revenue" }));
    expect(empty).not.toContain("Download CSV");
    const line = scoped(h(LineChart, { label: "Net", labels: ["a", "b"], series: [{ key: "net", label: "Net", values: [1, 2] }], format: String, exportId: "overview.net_revenue" }));
    expect(line).toContain('name="table" value="overview.net_revenue"');
    expect(line).toContain("Data table");
  });
});

describe("the address parameters an export repeats", () => {
  it("keeps the period, the comparison and the sort, and drops anything else", () => {
    expect(queryText({ period: "custom", from: "2026-09-01", to: "2026-09-10", compare: "year", sort: "units", dir: "asc", limit: "all", status: "out", evil: "<script>", utm: "x" })).toBe(
      "period=custom&compare=year&from=2026-09-01&to=2026-09-10&sort=units&dir=asc&limit=all&status=out",
    );
    expect(queryText({ period: ["7d", "30d"], compare: undefined })).toBe("period=7d");
  });

  it("reads them back, ignoring what is not on the list or too long", () => {
    expect(queryRecord("period=7d&compare=none&x=1")).toEqual({ period: "7d", compare: "none" });
    expect(queryRecord(`period=${"a".repeat(41)}`)).toEqual({});
    expect(queryRecord(null)).toEqual({});
    expect(queryRecord("a".repeat(500))).toEqual({});
  });
});
