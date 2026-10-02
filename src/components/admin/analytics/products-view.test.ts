import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { change, NO_FIGURE, safeRatio } from "@/lib/analytics-core";
import type { CompareMode } from "@/lib/analytics-period";
import { paretoSummary, productTable, type ProductRow } from "@/lib/analytics-products";
import type { ProductReportRow, ProductsReport } from "@/server/analytics-products-data";

import { dayText, deltaView, moneyOf, parseProductsSort, PRODUCT_LIMIT, PRODUCT_SORT_KEYS, ProductsView, productsHref, sortProducts, TOP_CHART, type ProductsViewProps } from "./products-view";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ");
/** The words only. */
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

const BASE = "/admin/shop";
const money = moneyOf("NOK", "nb-NO");

// ---------- fixtures ----------

type Costs = "all" | "partial" | "none";

/** `n` products, the best selling 100 000 øre and each one after it less; costs known for all, some, or none. */
function inputs(n: number, costs: Costs): ProductRow[] {
  return Array.from({ length: n }, (_, i): ProductRow => {
    const revenue = Math.round(1_000_000 / (i + 1));
    const known = costs === "all" || (costs === "partial" && i % 2 === 0);
    return {
      productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `Product ${i + 1}`,
      revenueMinor: revenue,
      units: 10 + i,
      orders: 5 + (i % 4),
      cogsMinor: known ? Math.round(revenue * 0.4) : null,
      knownCostRevenueMinor: known ? revenue : 0,
      refundsMinor: i === 1 ? Math.round(revenue * 0.1) : 0,
    };
  });
}

type Options = {
  n?: number;
  costs?: Costs;
  /** The comparison's mode; null is no comparison at all. */
  compare?: "previous" | "year" | null;
  views?: boolean;
  other?: boolean;
  over?: Partial<ProductsReport>;
};

/** A report made the way the server makes it: the same pure functions over the same kind of rows. */
function report({ n = 12, costs = "all", compare = "previous", views = true, other = true, over = {} }: Options = {}): ProductsReport {
  const rows = inputs(n, costs);
  if (other && n > 0) rows.push({ productId: "other", name: "Other lines", revenueMinor: 30_000, units: 0, orders: 3, cogsMinor: 0, knownCostRevenueMinor: 30_000, refundsMinor: 0 });
  const table = productTable(rows, { revenueMinor: rows.reduce((s, r) => s + r.revenueMinor, 0) + 12_000 });
  const reportRows: ProductReportRow[] = table.rows.map((r) => {
    const isOther = r.productId === "other";
    const seen = views && !isOther ? 400 - r.rank * 10 : null;
    const previousRevenue = compare ? (r.rank % 5 === 0 ? 0 : Math.round(r.revenueMinor * (r.rank % 2 === 0 ? 1.25 : 0.8))) : null;
    return {
      ...r,
      handle: isOther ? null : `product-${r.rank}`,
      other: isOther,
      unitsPerDay: r.units / 30,
      views: seen,
      conversion: seen === null ? null : safeRatio(r.orders, seen),
      previousRevenueMinor: previousRevenue,
      previousUnits: previousRevenue === null ? null : 4,
      revenueChange: previousRevenue === null ? null : change(r.revenueMinor, previousRevenue),
    };
  });
  const known = table.rows.reduce((s, r) => s + r.knownCostRevenueMinor, 0);
  const previousTotal = compare ? reportRows.reduce((s, r) => s + (r.previousRevenueMinor ?? 0), 0) : null;
  return {
    currency: "NOK",
    period: { from: "2026-09-02", to: "2026-10-02", days: 30 },
    compare: compare ? { from: "2026-08-03", to: "2026-09-02", days: 30 } : null,
    rows: reportRows,
    totals: table.totals,
    shareOfRevenue: table.shareOfRevenue,
    pareto: paretoSummary(table.rows.filter((r) => r.productId !== "other")),
    costCoverage: safeRatio(known, table.totals.revenueMinor > 0 ? table.totals.revenueMinor : null),
    reconciliation: { revenueMinor: table.totals.revenueMinor + 12_000, shippingMinor: 12_000, linesMinor: table.totals.revenueMinor, differenceMinor: 0, orders: 40 },
    previous: previousTotal === null ? null : { revenueMinor: previousTotal, units: 100 },
    revenueChange: previousTotal === null ? null : change(table.totals.revenueMinor, previousTotal),
    viewsFrom: views && n > 0 ? "2026-09-02" : null,
    unconverted: 0,
    missingCurrencies: [],
    truncated: false,
    ...over,
  };
}

function view(r: ProductsReport, extra: Partial<ProductsViewProps> = {}) {
  return html(h(ProductsView, { base: BASE, locale: "nb-NO", report: r, compareMode: (r.compare ? "previous" : "none") as CompareMode, sort: { key: "revenue", dir: "desc" }, showAll: false, keep: {}, ...extra }));
}

/** No broken figures anywhere in what the page says or carries in its attributes. */
function expectClean(markup: string) {
  expect(markup).not.toMatch(/NaN|Infinity|undefined/);
  expect(markup).not.toMatch(/>\s*null\s*</);
  expect(words(markup)).not.toMatch(/\bnull\b|\[object/);
}

// ---------- the empty store ----------

describe("ProductsView for a store with no orders", () => {
  const out = view(report({ n: 0, compare: null, views: false, other: false }));

  it("says calmly that there is nothing yet, with no figures at all", () => {
    expect(out).toContain("No product sales in this period");
    expect(out).toContain("Nothing to show yet.");
    expect(out).not.toContain("<table");
    expect(out).not.toContain("Product revenue");
    expectClean(out);
  });

  it("is clean with a comparison too, and with every kind of note a report can carry", () => {
    expectClean(view(report({ n: 0, compare: "previous", views: false, other: false, over: { truncated: true, unconverted: 2, missingCurrencies: ["SEK"] } })));
  });
});

// ---------- a normal store ----------

describe("ProductsView for a store with sales", () => {
  const r = report();
  const out = view(r);

  it("opens with the three figures: revenue, profit and how concentrated the sales are", () => {
    expect(out).toContain("Product revenue");
    expect(out).toContain("Profit from products");
    expect(out).toContain("How concentrated your sales are");
    expect(out).toContain(r.pareto!.text);
    expect(out).toMatch(/\d+ % of products make \d+ % of revenue/);
    expect(out).toContain("80/20 rule");
    expectClean(out);
  });

  it("writes amounts with the shared money formatter and the store's currency", () => {
    expect(out).toContain(money(r.totals.revenueMinor));
    expect(out).toMatch(/kr/);
  });

  it("shows the change against the previous period in the cards and the table", () => {
    expect(out).toContain("vs previous period");
    expect(out).toContain(">Change<");
    expect(out).toContain("Change is against 3 Aug 2026 to 1 Sep 2026.");
  });

  it("says what a changed figure is against when it is last year", () => {
    const year = view(report({ compare: "year" }), { compareMode: "year" });
    expect(year).toContain("vs same period last year");
    expect(year).not.toContain("vs previous period");
  });

  it("draws the table with a column for each thing asked for", () => {
    for (const label of ["Product", "Revenue", "Change", "Units", "Orders", "Margin", "Refund rate", "Share of revenue", "Share of profit", "Views", "Conversion"]) {
      expect(out, label).toMatch(new RegExp(`<th[^>]*scope="col"[^>]*>[\\s\\S]*?${label}`));
    }
    expect(out).toContain("<tfoot");
  });

  it("links each product to its admin page and the best seller is first", () => {
    expect(out).toContain(`href="${BASE}/products/${r.rows[0].productId}"`);
    expect(out.indexOf("Product 1<")).toBeLessThan(out.indexOf("Product 2<"));
  });

  it("keeps the lines that are not products apart: named, explained, last and left out of the best ten", () => {
    expect(out).toContain("Other lines");
    expect(out).toContain("Sign-up fees and other lines that are not products");
    const chart = out.match(/<ol[\s\S]*?<\/ol>/)![0];
    expect(chart).not.toContain("Other lines");
    const table = out.match(/<tbody>[\s\S]*<\/tbody>/)![0];
    expect(table.lastIndexOf("Other lines")).toBeGreaterThan(table.lastIndexOf("Product 12"));
  });

  it("explains its terms in a line each", () => {
    expect(out).toContain("profit as a share of revenue after refunds");
    expect(out).toContain("refunds as a share of the product's revenue");
    expect(out).toContain("a view is a page view, not a visitor");
    expect(out).toContain("Stripe's own dashboard");
  });

  it("has a name for every chart and the table", () => {
    const lists = out.match(/<ol[^>]*>/g) ?? [];
    expect(lists.length).toBeGreaterThan(0);
    for (const ol of lists) expect(ol).toMatch(/aria-label="[^"]+"/);
    for (const img of out.match(/<[^>]*role="img"[^>]*>/g) ?? []) expect(img).toMatch(/aria-label="[^"]+"/);
    expect(out).toContain("Top 10 products by revenue");
    expect(out).toMatch(/<caption class="sr-only">Products with revenue/);
  });

  it("charts at most the best ten, each a link", () => {
    const big = view(report({ n: 30 }));
    const chart = big.match(/<ol[\s\S]*?<\/ol>/)![0];
    expect(chart.match(/<li/g)).toHaveLength(TOP_CHART);
    expect(chart.match(/href="/g)).toHaveLength(TOP_CHART);
  });

  it("has no table to scroll the page: it scrolls in its own box", () => {
    expect(out).toContain("overflow-x-auto");
  });
});

// ---------- costs ----------

describe("ProductsView when costs are missing", () => {
  const r = report({ costs: "none" });
  const out = view(r);

  it("never shows a profit of zero: the card says what is missing and where to add it", () => {
    // The lines that are not products are known at a cost of 0, so the table's own total is not null: the page must not show it as the profit.
    expect(r.costCoverage).toBeLessThan(0.1);
    expect(out).toContain("Product costs are not entered, so profit cannot be worked out.");
    expect(out).toContain("Enter what your products cost");
    expect(out).toContain(`href="${BASE}/products"`);
    expect(out).toContain("Product costs are not entered");
    expect(out).toMatch(/data-state="missing"/);
  });

  it("shows a dash for margin and profit share in every row, and flags each product", () => {
    expect(out.match(/title="Cost not entered"/g)!.length).toBeGreaterThanOrEqual(12);
    expect(out).toContain("No cost entered");
    expect(out).not.toContain("Based on");
  });

  it("is clean", () => {
    expectClean(out);
  });
});

describe("ProductsView when some costs are known", () => {
  const r = report({ costs: "partial" });
  const out = view(r);

  it("says how much of the sales the profit rests on, and names products with no cost, linked", () => {
    expect(r.costCoverage).toBeGreaterThan(0);
    expect(r.costCoverage).toBeLessThan(1);
    expect(out).toMatch(/Profit and margin are based on \d+ % of sales/);
    expect(out).toMatch(/Based on \d+ % of sales/);
    expect(out).toContain("Missing costs on:");
    // Nothing is estimated here (unlike the Overview and Finance): the note says so.
    expect(out).toContain("nothing is estimated here");
    expect(out).toContain(`href="${BASE}/products/${r.rows.find((x) => x.name === "Product 2")!.productId}"`);
    expect(out).toMatch(/and \d+ more/);
  });

  it("is clean", () => {
    expectClean(out);
  });
});

// ---------- currencies and other notes ----------

describe("ProductsView notes", () => {
  it("says which currency could not be converted and that those orders are not zero", () => {
    const out = view(report({ over: { unconverted: 3, missingCurrencies: ["SEK", "DKK"] } }));
    expect(words(out)).toContain("3 orders and refunds in SEK, DKK have no exchange rate");
    expect(out).toContain("not counted as zero");
    expect(out).toContain(`href="${BASE}/settings/localization"`);
    expectClean(out);
  });

  it("names one order in the singular and a currency it does not know", () => {
    const out = view(report({ over: { unconverted: 1, missingCurrencies: [] } }));
    expect(words(out)).toContain("1 order or refund in another currency has no exchange rate");
  });

  it("says when the smallest products were cut", () => {
    expect(view(report({ over: { truncated: true } }))).toContain("Some products are left out");
  });

  it("explains missing views instead of showing zero, and drops the two columns", () => {
    const out = view(report({ views: false }));
    expect(out).toContain("Views and conversion are not shown");
    expect(out).toContain("not zero");
    expect(out).toContain(`href="${BASE}/analytics/settings"`);
    expect(out).not.toMatch(/>Views</);
    expect(out).not.toMatch(/>Conversion</);
    expectClean(out);
  });

  it("says since when views are counted when counting began inside the period", () => {
    const out = view(report({ over: { viewsFrom: "2026-09-20" } }));
    expect(out).toContain("Views counted since 20 Sep 2026");
  });

  it("leaves out the change when there is no comparison", () => {
    const out = view(report({ compare: null }), { compareMode: "none" });
    expect(out).not.toMatch(/>Change</);
    expect(out).not.toContain("vs previous period");
    expect(out).not.toContain("Change is against");
    expectClean(out);
  });

  it("says too few products to say rather than inventing a concentration", () => {
    const out = view(report({ n: 3 }));
    expect(out).toContain("too few to say");
    expect(out).not.toMatch(/% of products make/);
    expectClean(out);
  });

  it("is clean with one product that earned nothing but was refunded", () => {
    const refundOnly: ProductRow[] = [{ productId: "p1", name: "Refunded thing", revenueMinor: 0, units: 0, orders: 0, cogsMinor: null, knownCostRevenueMinor: 0, refundsMinor: 5_000 }];
    const table = productTable(refundOnly, { revenueMinor: 0 });
    const base = report({ n: 0, compare: null, views: false, other: false });
    const row: ProductReportRow = { ...table.rows[0], handle: "refunded", other: false, unitsPerDay: 0, views: null, conversion: null, previousRevenueMinor: null, previousUnits: null, revenueChange: null };
    const out = view({ ...base, rows: [row], totals: table.totals, shareOfRevenue: null, pareto: null, costCoverage: null });
    expectClean(out);
    expect(out).toContain("Refunded thing");
  });
});

// ---------- the address ----------

describe("parseProductsSort", () => {
  it("reads a column and a direction it knows", () => {
    expect(parseProductsSort({ sort: "units", dir: "asc" })).toEqual({ sort: { key: "units", dir: "asc" }, explicit: true });
    expect(parseProductsSort({ sort: ["margin", "units"], dir: ["desc"] })).toEqual({ sort: { key: "margin", dir: "desc" }, explicit: true });
  });

  it("starts a text column ascending and a figure descending when the direction is missing or wrong", () => {
    expect(parseProductsSort({ sort: "product" }).sort.dir).toBe("asc");
    expect(parseProductsSort({ sort: "revenue", dir: "sideways" }).sort.dir).toBe("desc");
  });

  it("ignores anything else and falls back to revenue, highest first", () => {
    for (const query of [{}, { sort: "drop table" }, { sort: "__proto__" }, { sort: "" }, { sort: undefined, dir: "asc" }]) {
      expect(parseProductsSort(query)).toEqual({ sort: { key: "revenue", dir: "desc" }, explicit: false });
    }
  });

  it("knows exactly the columns the table has", () => {
    for (const key of PRODUCT_SORT_KEYS) expect(parseProductsSort({ sort: key }).explicit).toBe(true);
  });
});

describe("sortProducts", () => {
  const r = report({ costs: "partial" });

  it("sorts by revenue, then by any figure, either way", () => {
    expect(sortProducts(r.rows, { key: "revenue", dir: "desc" }).filter((x) => !x.other).map((x) => x.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(sortProducts(r.rows, { key: "revenue", dir: "asc" })[0].name).toBe("Product 12");
    expect(sortProducts(r.rows, { key: "units", dir: "desc" })[0].name).toBe("Product 12");
    expect(sortProducts(r.rows, { key: "product", dir: "asc" })[0].name).toBe("Product 1");
  });

  it("puts figures that are not known last in either direction, and the lines that are not products after them", () => {
    for (const dir of ["asc", "desc"] as const) {
      const order = sortProducts(r.rows, { key: "margin", dir });
      const products = order.filter((x) => !x.other);
      const firstUnknown = products.findIndex((x) => x.margin === null);
      expect(products.slice(firstUnknown).every((x) => x.margin === null)).toBe(true);
      expect(products.slice(0, firstUnknown).every((x) => x.margin !== null)).toBe(true);
      expect(order[order.length - 1].other).toBe(true);
    }
  });

  it("ranks a product that is new above every percentage when sorted by change", () => {
    const order = sortProducts(r.rows, { key: "change", dir: "desc" }).filter((x) => !x.other);
    expect(order[0].revenueChange?.pct).toBeNull();
  });

  it("falls back to revenue for a column it does not know, and does not change its input", () => {
    const before = r.rows.map((x) => x.productId);
    expect(sortProducts(r.rows, { key: "nonsense", dir: "asc" })[0].rank).toBe(12);
    expect(r.rows.map((x) => x.productId)).toEqual(before);
  });
});

describe("the table's links", () => {
  it("sort by links that keep the period, and flip the current column", () => {
    const out = view(report(), { keep: { period: "7d", compare: "year" }, sort: { key: "units", dir: "desc" } });
    expect(out).toContain(`href="${BASE}/analytics/products?period=7d&compare=year&sort=units&dir=asc#products-table"`);
    expect(out).toContain(`href="${BASE}/analytics/products?period=7d&compare=year&sort=product&dir=asc#products-table"`);
    expect(out).toMatch(/<th[^>]*aria-sort="descending"[^>]*>[\s\S]*?Units/);
  });

  it("builds an address from a state, leaving out what is default", () => {
    expect(productsHref("/p", {}, null, false)).toBe("/p#products-table");
    expect(productsHref("/p", { period: "7d" }, { key: "units", dir: "asc" }, true)).toBe("/p?period=7d&sort=units&dir=asc&limit=all#products-table");
  });
});

describe("the table's length", () => {
  const big = report({ n: 80 });

  it(`shows the first ${PRODUCT_LIMIT} and a link to show all`, () => {
    const out = view(big);
    const rows = out.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr/g)!;
    expect(rows).toHaveLength(PRODUCT_LIMIT);
    expect(out).toContain(`Show all ${big.rows.length} rows`);
    expect(out).toContain("limit=all");
  });

  it("shows every row with a link back when asked", () => {
    const out = view(big, { showAll: true });
    expect(out.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr/g)).toHaveLength(big.rows.length);
    expect(out).toContain(`Show only the first ${PRODUCT_LIMIT}`);
    expect(out).toMatch(/sort=revenue&dir=asc&limit=all/);
  });

  it("offers no toggle for a short table", () => {
    const out = view(report());
    expect(out).not.toContain("Show all");
    expect(out).not.toContain("Show only the first");
  });
});

// ---------- helpers ----------

describe("helpers", () => {
  it("writes money and the dash", () => {
    expect(moneyOf("NOK", "nb-NO")(12_345)).toMatch(/123,45/);
    for (const bad of [null, undefined, NaN, Infinity]) expect(moneyOf("NOK", "nb-NO")(bad)).toBe(NO_FIGURE);
  });

  it("writes a day, and leaves what is not a day as it came", () => {
    expect(dayText("2026-10-03")).toBe("3 Oct 2026");
    expect(dayText("soon")).toBe("soon");
  });

  it("turns a change into what the cards draw, null into nothing", () => {
    expect(deltaView(null)).toBeNull();
    expect(deltaView(change(150, 100))).toMatchObject({ text: "+50.0 %", abs: 50, verdict: "good" });
    expect(deltaView(change(50, 100))).toMatchObject({ text: "−50.0 %", verdict: "bad" });
    expect(deltaView(change(5, 0))).toMatchObject({ text: "new", verdict: "good" });
  });
});
