import { describe, expect, it } from "vitest";

import { customReportsEn } from "./admin-messages/custom-reports.en";
import { customReportsNb } from "./admin-messages/custom-reports.nb";
import {
  allowedDimensions,
  blankSpec,
  columnAddsUp,
  describeSpec,
  DIMENSION_KEYS,
  dimensionAllowed,
  grainIn,
  METRIC_KEYS,
  needsRestRow,
  READY_KEYS,
  READY_REPORTS,
  sortOf,
  specProblems,
  type ReportSpec,
} from "./report-catalogue";
import { readSpec } from "./report-catalogue-schema";

const spec = (o: Partial<ReportSpec>): ReportSpec => ({ ...blankSpec(), ...o });

describe("the report catalogue (D345)", () => {
  it("has words for every metric and dimension in English and Norwegian, and every metric is in docs/analytics.md", async () => {
    const { readFileSync } = await import("node:fs");
    const doc = readFileSync("docs/analytics.md", "utf8");
    for (const words of [customReportsEn, customReportsNb]) {
      for (const m of METRIC_KEYS) expect(words.catalogue.metrics[m], m).toBeTruthy();
      for (const d of DIMENSION_KEYS) expect(words.catalogue.dimensions[d], d).toBeTruthy();
    }
    for (const m of METRIC_KEYS) expect(doc, `docs/analytics.md defines ${m}`).toContain(`\`${m}\``);
  });

  it("lets refunds be cut only by what a refund has, and an average never by a line", () => {
    expect(allowedDimensions("refunds")).toEqual(["day", "week", "month", "quarter", "market", "currency", "payment_method", "customer_type"]);
    expect(allowedDimensions("aov")).not.toContain("product");
    expect(allowedDimensions("net_sales")).toEqual([...DIMENSION_KEYS]);
    expect(dimensionAllowed(["net_sales", "refunds"], "product")).toBe(false);
    expect(dimensionAllowed(["net_sales", "refunds"], "market")).toBe(true);
  });

  it("names every reason a spec cannot run", () => {
    expect(specProblems(blankSpec())).toEqual([]);
    expect(specProblems(spec({ metrics: [] }))).toEqual([{ kind: "no_metric" }]);
    expect(specProblems(spec({ dimensions: ["day", "month"] }))).toEqual([{ kind: "two_time_dimensions" }]);
    expect(specProblems(spec({ metrics: ["refunds"], dimensions: ["product"] }))).toEqual([{ kind: "refunds_by", dimension: "product" }]);
    // A filter is a cut too.
    expect(specProblems(spec({ metrics: ["aov"], dimensions: [], filters: [{ dimension: "tag", values: ["x"] }] }))).toEqual([
      { kind: "not_by_line", metric: "aov", dimension: "tag" },
    ]);
    expect(specProblems(spec({ metrics: ["orders", "orders"] }))).toEqual([{ kind: "repeated", key: "orders" }]);
    expect(specProblems(spec({ period: { preset: "custom", compare: "none" } }))).toEqual([{ kind: "custom_period" }]);
    expect(specProblems(spec({ sort: "units" }))).toEqual([{ kind: "sort", key: "units" }]);
    expect(specProblems(spec({ limit: 501 }))).toEqual([{ kind: "limit" }]);
  });

  it("counts an order metric from lines when a line dimension cuts or filters it, and says which columns add up", () => {
    expect(grainIn({ dimensions: ["product"], filters: [] }, "net_sales")).toBe("line");
    expect(grainIn({ dimensions: [], filters: [{ dimension: "product", values: ["p"] }] }, "orders")).toBe("line");
    expect(grainIn({ dimensions: ["market"], filters: [] }, "net_sales")).toBe("order");
    expect(grainIn({ dimensions: ["day"], filters: [] }, "refunds")).toBe("refund");
    expect(columnAddsUp({ dimensions: ["product"] }, "net_sales")).toBe(true);
    expect(columnAddsUp({ dimensions: ["product"] }, "orders")).toBe(false);
    expect(columnAddsUp({ dimensions: ["market"] }, "customers")).toBe(false);
    expect(columnAddsUp({ dimensions: ["category"] }, "net_sales")).toBe(false);
    expect(columnAddsUp({ dimensions: ["day"] }, "aov")).toBe(false);
    expect(needsRestRow({ metrics: ["net_sales"], dimensions: ["product"] })).toBe(true);
    expect(needsRestRow({ metrics: ["units"], dimensions: ["product"] })).toBe(false);
  });

  it("sorts by time ascending, else by the first metric descending", () => {
    expect(sortOf(spec({ dimensions: ["product", "month"] }))).toEqual({ key: "month", descending: false });
    expect(sortOf(spec({ metrics: ["units"], dimensions: ["product"] }))).toEqual({ key: "units", descending: true });
  });

  it("has ready reports that are all allowed and read back through the schema", () => {
    for (const key of READY_KEYS) {
      expect(specProblems(READY_REPORTS[key]), key).toEqual([]);
      expect(readSpec(JSON.parse(JSON.stringify(READY_REPORTS[key]))), key).toEqual(READY_REPORTS[key]);
    }
    expect(readSpec({ metrics: ["net_sales; drop table"] })).toBeNull();
    expect(readSpec({ metrics: ["net_sales"] })).toMatchObject({ dimensions: [], filters: [], limit: 100, period: { preset: "30d", compare: "previous" } });
  });

  it("says what a report is from its spec alone", () => {
    const text = describeSpec(
      spec({ metrics: ["net_sales", "units"], dimensions: ["product"], filters: [{ dimension: "market", values: ["NO", "SE"] }] }),
      customReportsEn.catalogue,
      { period: "Last 30 days", comparison: "the previous period", currency: "NOK", filterValue: (_, v) => (v === "NO" ? "Norway" : "Sweden") },
    );
    expect(text).toBe("Revenue and units sold by product, only where country is Norway or Sweden, Last 30 days, compared with the previous period. Paid orders, without VAT, in NOK.");
  });
});
