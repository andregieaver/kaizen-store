import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseCsv, writeCsv } from "./csv";
import {
  ANALYTICS_PAGES,
  ANALYTICS_TABLES,
  ANALYTICS_TABLE_IDS,
  NOT_EXPORTED,
  downloadLabel,
  isExportable,
  lastDayOf,
  openingTagAt,
  percentText,
  rawTableUses,
  tableFileName,
  tableFileRows,
  tableHeader,
  tableRows,
  tableUses,
} from "./analytics-export";

const VIEWS = path.join(process.cwd(), "src", "components", "admin", "analytics");

describe("the registry", () => {
  it("has a table with a caption, a view that exists, and headers that are English snake_case and unique", () => {
    expect(ANALYTICS_TABLE_IDS.length).toBeGreaterThan(40);
    expect(new Set(ANALYTICS_TABLE_IDS).size).toBe(ANALYTICS_TABLE_IDS.length);
    for (const t of Object.values(ANALYTICS_TABLES)) {
      expect([t.id, t.caption.length > 8]).toEqual([t.id, true]);
      expect([t.id, existsSync(path.join(VIEWS, t.view))]).toEqual([t.id, true]);
      expect(ANALYTICS_PAGES).toContain(t.page);
      const headers = tableHeader(t, true);
      expect([t.id, new Set(headers).size === headers.length]).toEqual([t.id, true]);
      for (const h of headers) expect([t.id, h, /^[a-z][a-z0-9_]*$/.test(h)]).toEqual([t.id, h, true]);
      const keys = t.columns.map((c) => c.key);
      expect([t.id, new Set(keys).size === keys.length]).toEqual([t.id, true]);
      expect(t.id.startsWith(`${t.page}.`) || ["traffic", "marketing", "settings"].includes(t.page)).toBe(true);
    }
  });

  it("names the money tables (a currency column) and no others", () => {
    for (const t of Object.values(ANALYTICS_TABLES)) {
      const hasAmount = t.columns.some((c) => c.kind === "amount");
      expect([t.id, t.money]).toEqual([t.id, hasAmount]);
    }
  });

  it("keeps the tables that are not exported apart from the ones that are, each with a reason; VAT, OSS and IOSS keep D161's files", () => {
    for (const [id, reason] of Object.entries(NOT_EXPORTED)) {
      expect(isExportable(id)).toBe(false);
      expect(reason.length).toBeGreaterThan(15);
    }
    expect(Object.keys(NOT_EXPORTED).filter((i) => i.startsWith("tax.") || i.startsWith("oss.")).length).toBe(Object.keys(NOT_EXPORTED).length);
    expect(Object.values(NOT_EXPORTED).every((r) => /D161/.test(r))).toBe(true);
    expect(isExportable("products.table")).toBe(true);
    expect(isExportable("nope")).toBe(false);
  });

  it("has a comparison column only where the page compares, and never beside a text", () => {
    for (const t of Object.values(ANALYTICS_TABLES)) for (const c of t.columns.filter((x) => x.previous)) expect(["amount", "int", "percent", "decimal"]).toContain(c.kind);
    expect(ANALYTICS_TABLES["products.table"].columns.filter((c) => c.previous).map((c) => c.header)).toEqual(["revenue", "units"]);
  });
});

describe("a table's file", () => {
  const products = ANALYTICS_TABLES["products.table"];
  const rows = [
    { product: "=1+1 Boot", handle: "boot", revenue: 12_345_600, units: 10, orders: 8, margin: 0.4255, refunds: 0.02, share: 0.5, profitShare: null, views: null, conversion: null },
    { product: "Sock", handle: "sock", revenue: 5, units: 1, orders: 1, margin: null, refunds: 0, share: 0.0001, profitShare: 0.1, views: 5, conversion: 0.2 },
  ];
  const period = { from: "2026-09-01", to: "2026-10-01" };

  it("has the period, the main currency and no comparison columns when the page does not compare", () => {
    const header = tableHeader(products, false);
    expect(header.slice(-3)).toEqual(["currency", "period_from", "period_to"]);
    expect(header).not.toContain("revenue_previous");
    const out = tableFileRows(products, { rows, period, currency: "NOK" });
    expect(out[0]).toEqual(header);
    expect(out).toHaveLength(3);
    expect(out[1].slice(-3)).toEqual(["NOK", "2026-09-01", "2026-09-30"]);
  });

  it("writes the figures as the page's loader gave them: amounts as decimals, shares as percentages, dashes as empty, never zero", () => {
    const [, first, second] = tableFileRows(products, { rows, period, currency: "NOK" });
    const col = (r: unknown[], h: string) => r[tableHeader(products, false).indexOf(h)];
    expect(col(first, "revenue")).toEqual({ num: "123456.00" });
    expect(col(first, "margin")).toEqual({ num: "42.55" });
    expect(col(first, "refund_rate")).toEqual({ num: "2.00" });
    expect(col(first, "share_of_profit")).toBeNull();
    expect(col(first, "views")).toBeNull();
    expect(col(second, "margin")).toBeNull();
    expect(col(second, "refund_rate")).toEqual({ num: "0.00" });
    expect(col(second, "share_of_revenue")).toEqual({ num: "0.01" });
    expect(col(first, "units")).toBe(10);
  });

  it("adds a previous column for each compared figure, with the previous period, aligned with the rows", () => {
    const previous = { period: { from: "2026-08-02", to: "2026-09-01" }, rows: [{ revenue: 10_000_000, units: 9 }] };
    const out = tableFileRows(products, { rows, period, previous, currency: "NOK" });
    const header = out[0] as string[];
    const at = header.indexOf("revenue_previous");
    expect(header.slice(at, at + 2)).toEqual(["revenue_previous", "units_previous"]);
    expect(header.slice(at + 2, at + 5)).toEqual(["currency", "period_from", "period_to"]);
    expect(header).toContain("previous_from");
    expect(header.slice(-2)).toEqual(["previous_from", "previous_to"]);
    const col = (r: unknown[], h: string) => r[header.indexOf(h)];
    expect(col(out[1], "revenue_previous")).toEqual({ num: "100000.00" });
    expect(col(out[1], "previous_from")).toBe("2026-08-02");
    expect(col(out[1], "previous_to")).toBe("2026-08-31");
    // A row with no counterpart has nothing, not zero.
    expect(col(out[2], "revenue_previous")).toBeNull();
    expect(col(out[2], "previous_from")).toBe("2026-08-02");
  });

  it("never lets a cell start with a formula character: a product titled =1+1 is text, and a negative amount is a number", () => {
    const csv = writeCsv(tableFileRows(products, { rows: [{ ...rows[0], revenue: -1250 }], period, currency: "NOK" }), "excel_nordic");
    const body = parseCsv(csv).rows[1];
    expect(body[0]).toBe("'=1+1 Boot");
    expect(body.some((c) => /^[=+@]/.test(c))).toBe(false);
    expect(csv).toContain(";-12,50;");
  });

  it("names the file by table and period, and the period's last day is the day before its exclusive end", () => {
    expect(tableFileName(products, period)).toBe("products.table_2026-09-01_2026-09-30.csv");
    expect(lastDayOf("2026-03-01")).toBe("2026-02-28");
    expect(lastDayOf("2024-03-01")).toBe("2024-02-29");
    expect(lastDayOf("2027-01-01")).toBe("2026-12-31");
  });

  it("is exact for amounts (integers) and works for a table with only text and counts, with no currency column", () => {
    const terms = ANALYTICS_TABLES["traffic.top_terms"];
    expect(tableHeader(terms, false)).toEqual(["search", "searches", "results_shown", "found_nothing", "opened_a_result", "click_through", "period_from", "period_to"]);
    const [row] = tableRows(terms, { rows: [{ term: "sko", searches: 12, results: 4, zero: 0, clicked: 3, ctr: 0.25 }], period, currency: "NOK" });
    expect(row).toEqual(["sko", 12, 4, 0, 3, { num: "25.00" }, "2026-09-01", "2026-09-30"]);
  });

  it("says in the button what was left out, so the file never states more than the page", () => {
    expect(downloadLabel({ orders: 0, currencies: [] })).toBe("Download CSV");
    expect(downloadLabel({ orders: 3, currencies: ["SEK"] })).toBe("Download CSV: 3 orders in SEK left out, as on this page");
    expect(downloadLabel({ orders: 1, currencies: ["SEK", "DKK"] })).toBe("Download CSV: 1 order in SEK, DKK left out, as on this page");
  });

  it("rounds a percentage half up to two decimals", () => {
    expect(percentText(0.12345)).toBe("12.35");
    expect(percentText(1)).toBe("100.00");
    expect(percentText(0)).toBe("0.00");
  });
});

describe("finding what a view draws", () => {
  it("balances braces and quotes, so an arrow function and a comparison do not end a tag", () => {
    const source = `<DataTable caption="x > y" columns={cols} rowKey={(r) => r.id} empty={a > b ? "p" : "q"} exportId="products.table" />\n<p>after</p>`;
    expect(openingTagAt(source, 0)).toBe(source.split("\n")[0]);
  });

  it("finds each table and chart, with its export id or its reason for none", () => {
    const source = [
      `<DataTable caption="a" exportId="products.table" columns={c} rows={r} />`,
      `<HorizontalBars label="b" rows={x} exportId={"products.top_revenue"} />`,
      `<DataTable caption="c" exportable={false} exportReason="tax.vat" columns={c} rows={r} />`,
      `<LineChart label="d" series={[{ key: "a", values: v }]} />`,
      `<Funnel label="e" stages={s} exportId="traffic.funnel"/>`,
      `<DataTableFooter />`,
    ].join("\n");
    expect(tableUses(source)).toEqual([
      { component: "DataTable", line: 1, exportId: "products.table", exportable: true },
      { component: "HorizontalBars", line: 2, exportId: "products.top_revenue", exportable: true },
      { component: "DataTable", line: 3, exportId: "tax.vat", exportable: false },
      { component: "LineChart", line: 4, exportId: null, exportable: null },
      { component: "Funnel", line: 5, exportId: "traffic.funnel", exportable: true },
    ]);
  });

  it("finds hand-made tables and the id they carry", () => {
    expect(rawTableUses(`<table className="w-full" data-export-id="finance.bridge">\n<table className="x">`)).toEqual([{ line: 1, id: "finance.bridge" }, { line: 2, id: null }]);
  });
});
