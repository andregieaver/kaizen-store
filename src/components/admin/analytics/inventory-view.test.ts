import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { safeRatio, NO_FIGURE } from "@/lib/analytics-core";
import { analyseVariant, inventoryValue, sellThrough, stockoutAlerts, stockWatch, turnover, type InventoryRow, type StockStatus } from "@/lib/analytics-inventory";
import type { InventoryReport, InventoryReportRow } from "@/server/analytics-inventory-data";

import {
  alertText,
  ALERTS_SHOWN,
  daysText,
  INVENTORY_SORT_KEYS,
  inventoryHref,
  InventoryView,
  moneyOf,
  parseInventoryParams,
  perDayOf,
  ROW_LIMIT,
  sortVariants,
  type InventoryViewProps,
} from "./inventory-view";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ");
/** The words only. */
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

const BASE = "/admin/shop";
const money = moneyOf("NOK", "nb-NO");

// ---------- fixtures ----------

type Spec = Partial<InventoryRow> & { title?: string; i: number };

/** A stocked variant as the server reads it: the same pure analysis over the same kind of row. */
function variant({ i, title, ...over }: Spec): InventoryReportRow {
  const base: InventoryRow = {
    variantId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    productId: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
    name: title ?? `Item ${i}`,
    sku: `SKU-${i}`,
    tracked: true,
    onHand: 20,
    stockPolicy: "deny",
    owed: 0,
    sold7: 2,
    sold30: 8,
    soldPeriod: 8,
    lastSoldDaysAgo: 3,
    ageDays: 400,
    costMinor: 5_000,
    lowStockThreshold: null,
    ...over,
  };
  return {
    ...analyseVariant(base),
    handle: `item-${i}`,
    title: title ?? `Item ${i}`,
    options: [],
    lastSoldAt: base.lastSoldDaysAgo === null ? null : "2026-09-29T10:00:00.000Z",
    sold90: base.sold30 * 2,
    priceExVatMinor: 12_000,
  };
}

/** A report made the way the server makes it. */
function report(rows: InventoryReportRow[], over: Partial<InventoryReport> = {}): InventoryReport {
  const plain: InventoryRow[] = rows.map((r) => ({
    variantId: r.variantId,
    productId: r.productId,
    name: r.name,
    sku: r.sku,
    tracked: r.tracked,
    onHand: r.onHand,
    stockPolicy: r.stockPolicy,
    owed: r.owed,
    sold7: r.sold7,
    sold30: r.sold30,
    soldPeriod: r.soldPeriod,
    lastSoldDaysAgo: r.lastSoldDaysAgo,
    ageDays: r.ageDays,
    costMinor: r.costMinor,
    lowStockThreshold: r.lowStockThreshold,
  }));
  const value = inventoryValue(plain);
  const count = (s: StockStatus) => rows.filter((r) => r.status === s).length;
  const dead = rows.filter((r) => r.status === "dead");
  const sold30 = rows.reduce((s, r) => s + r.sold30, 0);
  const onHandUnits = rows.reduce((s, r) => s + Math.max(0, r.onHand), 0);
  const cogs = rows.reduce((s, r) => s + (r.costMinor === null ? 0 : r.costMinor * r.sold30 * 4), 0);
  const known = rows.filter((r) => r.costMinor !== null).reduce((s, r) => s + r.sold30 * 4, 0);
  const all = rows.reduce((s, r) => s + r.sold30 * 4, 0);
  const alerts = stockoutAlerts(plain);
  return {
    currency: "NOK",
    now: "2026-10-02T10:00:00.000Z",
    today: "2026-10-02",
    lookbackDays: 365,
    rows,
    variants: rows.length,
    rowsTruncated: false,
    readTruncated: false,
    totals: {
      variants: rows.length,
      value,
      out: count("out"),
      low: count("low"),
      ok: count("ok"),
      dead: dead.length,
      deadUnits: dead.reduce((s, r) => s + r.onHand, 0),
      deadValueMinor: dead.reduce((s, r) => s + (r.valueMinor ?? 0), 0),
      cogs365Minor: cogs,
      cogs365Coverage: safeRatio(known, all > 0 ? all : null),
      turnover: turnover(cogs, value.valueMinor),
      sold30,
      sellThrough30: sellThrough(sold30, onHandUnits),
      ...stockWatch(plain),
    },
    alerts,
    alertsTotal: alerts.length,
    ...over,
  };
}

/** A store with one of each state and a few that are fine. */
function normal(): InventoryReport {
  // In the order the server gives them: out, low, dead, then the rest.
  return report([
    variant({ i: 2, title: "Kenya Coffee 250g (Whole beans)", onHand: 0, sold7: 3, sold30: 9 }), // out
    variant({ i: 1, title: "Ethiopian Coffee 1kg", onHand: 4, sold7: 5, sold30: 14 }), // low, and about to run out
    variant({ i: 3, title: "Old Mug", onHand: 30, sold7: 0, sold30: 0, lastSoldDaysAgo: 120 }), // dead
    variant({ i: 4, title: "Tea Tin", onHand: 50, sold7: 1, sold30: 4 }),
    variant({ i: 5, title: "Grinder", onHand: 12, sold7: 2, sold30: 6 }),
  ]);
}

const props = (r: InventoryReport, extra: Partial<InventoryViewProps> = {}): InventoryViewProps => ({ base: BASE, locale: "nb-NO", report: r, status: null, sort: null, showAll: false, ...extra });
const view = (r: InventoryReport, extra: Partial<InventoryViewProps> = {}) => html(h(InventoryView, props(r, extra)));

/** No broken figures anywhere in what the page says or carries in its attributes. */
function expectClean(markup: string) {
  expect(markup).not.toMatch(/NaN|Infinity|undefined/);
  expect(markup).not.toMatch(/>\s*null\s*</);
  expect(words(markup)).not.toMatch(/\bnull\b|\[object/);
}

// ---------- no tracked stock ----------

describe("InventoryView for a store with no stocked products", () => {
  const out = view(report([]));

  it("says calmly that there is no stock to follow, and where to add products", () => {
    expect(out).toContain("No stock to follow yet");
    expect(out).toContain("No stocked products.");
    expect(out).toContain(`href="${BASE}/products"`);
    expect(out).not.toContain("<table");
    expect(out).not.toContain("Stock value at cost");
    expectClean(out);
  });

  it("is clean with the note for a cut read too", () => {
    expectClean(view(report([], { readTruncated: true })));
  });
});

// ---------- a normal store ----------

describe("InventoryView for a store with stock and sales", () => {
  const r = normal();
  const out = view(r);

  it("starts with what is about to run out, in a sentence that links to the product", () => {
    expect(out.indexOf("Running out")).toBeLessThan(out.indexOf("Stock value at cost"));
    expect(out).toContain("Ethiopian Coffee 1kg: estimated stockout in ");
    expect(out).toMatch(/Ethiopian Coffee 1kg: estimated stockout in \d+ days?/);
    expect(out).toContain("Kenya Coffee 250g (Whole beans): out of stock");
    expect(out).toContain(`href="${BASE}/products/${r.rows.find((x) => x.name === "Ethiopian Coffee 1kg")!.productId}"`);
    expectClean(out);
  });

  it("shows the figures: value at cost, dead stock, out, low, turnover and sell-through", () => {
    for (const label of ["Stock value at cost", "Dead stock", "Out of stock", "Running low", "Stock turnover", "Sell-through, 30 days"]) expect(words(out), label).toContain(label);
    expect(out).toContain(money(r.totals.value.valueMinor));
    expect(out).toMatch(/\d+\.\d times a year/);
    expect(out).toMatch(/\d+\.\d %/);
  });

  it("links each count to the table filtered to it", () => {
    expect(out).toContain(`href="${BASE}/analytics/inventory?status=out#variants"`);
    expect(out).toContain(`href="${BASE}/analytics/inventory?status=low#variants"`);
    expect(out).toContain(`href="${BASE}/analytics/inventory?status=dead#variants"`);
  });

  it("explains its terms where they are used", () => {
    expect(out).toContain("What the stock on hand cost you");
    expect(out).toContain("How many times the stock sells through in a year");
    expect(out).toContain("Dead stock: on hand and not sold for 90 days.");
    expect(out).toContain("units on hand divided by the pace of sales");
  });

  it("draws a table of the variants with a column for each thing asked for", () => {
    for (const label of ["Product", "Status", "On hand", "Per day, 7 days", "Per day, 30 days", "Days left", "Tied up at cost", "Last sold"]) {
      expect(out, label).toMatch(new RegExp(`<th[^>]*scope="col"[^>]*>[\\s\\S]*?${label}`));
    }
    expect(out).toMatch(/<caption class="sr-only">Stocked variants/);
  });

  it("gives every status a word and an icon, not only a colour", () => {
    expect(out).toContain("Out of stock");
    expect(out).toContain("Running low");
    expect(out).toContain("Not selling");
    expect(out).toContain("In stock");
    expect(out).toMatch(/aria-hidden="true"[^>]*>✕/);
  });

  it("lists the most urgent first and shows no sort until one is asked for", () => {
    const table = out.match(/<tbody>[\s\S]*<\/tbody>/)![0];
    expect(table.indexOf("Kenya Coffee")).toBeLessThan(table.indexOf("Ethiopian Coffee"));
    expect(table.indexOf("Ethiopian Coffee")).toBeLessThan(table.indexOf("Old Mug"));
    expect(out).not.toContain("aria-sort=\"descending\"");
    expect(out).not.toContain("aria-sort=\"ascending\"");
  });

  it("scrolls the table in its own box", () => {
    expect(out).toContain("overflow-x-auto");
  });
});

// ---------- costs ----------

describe("InventoryView when costs are missing", () => {
  const r = report([variant({ i: 1, costMinor: null }), variant({ i: 2, costMinor: null, onHand: 40 }), variant({ i: 3, costMinor: null, onHand: 0, sold7: 2, sold30: 5 })]);
  const out = view(r);

  it("never values the stock at zero: the card says what is missing and where to add it", () => {
    expect(r.totals.value.valueMinor).toBe(0);
    expect(out).toContain("Product costs are not entered, so the stock cannot be valued.");
    expect(out).toContain("Enter what your products cost");
    expect(out).toContain(`href="${BASE}/products"`);
    expect(out).toMatch(/data-state="missing"/);
  });

  it("says no cost in the table instead of a value, and the turnover has no figure", () => {
    expect(out).toContain("No cost");
    expect(out).toContain("Product costs are not entered, so the stock has no value to measure against.");
    expect(out).not.toContain("times a year");
  });

  it("is clean", () => {
    expectClean(out);
  });
});

describe("InventoryView when some costs are known", () => {
  const r = report([variant({ i: 1, onHand: 10 }), variant({ i: 2, onHand: 10, costMinor: null }), variant({ i: 3, onHand: 20, costMinor: 1_000 })]);
  const out = view(r);

  it("says how much of the stock the value covers, and how many units are left out", () => {
    expect(r.totals.value.coverage).toBeCloseTo(0.75);
    expect(out).toContain("Stock value covers 75 % of the units on hand");
    expect(out).toContain("10 units on hand have no cost");
    expect(out).toContain("Based on 75 % of 40 units on hand");
    expect(out).toContain("not valued at zero");
  });

  it("says when what was sold had no known cost, so turnover is not worked out", () => {
    const noCostSold = report([variant({ i: 1, onHand: 10 }), variant({ i: 2, onHand: 10 })], {});
    const broken = { ...noCostSold, totals: { ...noCostSold.totals, cogs365Coverage: 0, turnover: 0 } };
    const text = view(broken);
    expect(text).toContain("The goods sold had no cost entered");
    expect(text).not.toContain("times a year");
  });

  it("is clean", () => {
    expectClean(out);
  });
});

// ---------- no sales yet ----------

describe("InventoryView when nothing has sold", () => {
  const r = report([variant({ i: 1, onHand: 10, sold7: 0, sold30: 0, lastSoldDaysAgo: null, ageDays: 20 }), variant({ i: 2, onHand: 5, sold7: 0, sold30: 0, lastSoldDaysAgo: null, ageDays: 20 })]);
  const out = view(r);

  it("says so, and shows no pace, no days left, no turnover and no sell-through, never as zero", () => {
    expect(out).toContain("Nothing has sold in the last 30 days");
    expect(out).toContain("show a dash, not zero");
    expect(out).toContain("nothing to say about what will run out");
    expect(out).toContain("Nothing sold in the last 30 days, so it cannot be worked out");
    expect(out).toMatch(/Nothing has sold in the last 365 days|Nothing sold in the last 30 days and nothing is on hand|Nothing has sold/);
    expect(out).not.toContain("times a year");
    // Nothing sold of 15 on hand is a real 0 %, and the note says so rather than calling it unknown.
    expect(out).toContain("Sell-through is 0 % because nothing sold.");
  });

  it("still shows the stock itself and what is tied up", () => {
    expect(out).toContain(money(r.totals.value.valueMinor));
    expect(out).toContain("15 units on hand");
  });

  it("is clean", () => {
    expectClean(out);
  });
});

describe("InventoryView with nothing on hand", () => {
  const r = report([variant({ i: 1, onHand: 0, sold7: 0, sold30: 0, lastSoldDaysAgo: null }), variant({ i: 2, onHand: 0 })]);
  const out = view(r);

  it("says there is no stock to value instead of a value of zero", () => {
    expect(out).toContain("Nothing is on hand, so there is no stock to value.");
    expect(out).toContain("Nothing is on hand, so there is nothing to measure against.");
    expectClean(out);
  });
});

// ---------- notes ----------

describe("InventoryView notes", () => {
  it("says when the stock was only partly read", () => {
    const out = view(report([variant({ i: 1 })], { readTruncated: true }));
    expect(out).toContain("Only part of the stock is counted");
    expectClean(out);
  });

  it("says when the table lists only the variants that need attention most", () => {
    const out = view(report([variant({ i: 1 }), variant({ i: 2 })], { rowsTruncated: true, variants: 5_000 }));
    expect(words(out)).toContain("The table lists the 2 that need attention most, of 5 000 variants.");
  });

  it("notes dead stock whose cost is not known, and whose value is therefore not shown as zero", () => {
    const r = report([variant({ i: 1, onHand: 30, sold7: 0, sold30: 0, lastSoldDaysAgo: 120, costMinor: null }), variant({ i: 2 })]);
    const out = view(r);
    expect(out).toContain("Costs are not entered, so what is tied up is not known.");
    expectClean(out);
  });

  it("says what is partly known about dead stock", () => {
    const r = report([
      variant({ i: 1, onHand: 30, sold7: 0, sold30: 0, lastSoldDaysAgo: 120, costMinor: null }),
      variant({ i: 2, onHand: 10, sold7: 0, sold30: 0, lastSoldDaysAgo: 150, costMinor: 1_000 }),
    ]);
    expect(view(r)).toContain("at cost where the cost is known");
  });
});

// ---------- alerts ----------

describe("the alert list", () => {
  const many = report(Array.from({ length: 12 }, (_, i) => variant({ i: i + 1, title: `Fast ${i + 1}`, onHand: i % 2, sold7: 7, sold30: 20 })));

  it(`lists ${ALERTS_SHOWN} in full and folds the rest away, with no script`, () => {
    expect(many.alerts.length).toBeGreaterThan(ALERTS_SHOWN);
    const out = view(many);
    expect(out).toContain("<details");
    expect(out).toContain(`Show ${many.alerts.length - ALERTS_SHOWN} more`);
    expect(out.match(/estimated stockout|out of stock/g)!.length).toBe(many.alerts.length);
  });

  it("says when there are more than were listed", () => {
    const out = view({ ...many, alertsTotal: 120 });
    expect(out).toContain(`Showing the ${many.alerts.length} most urgent of 120.`);
  });

  it("is calm when nothing is about to run out", () => {
    const out = view(report([variant({ i: 1, onHand: 500, sold7: 2, sold30: 8 })]));
    expect(out).toContain("Nothing that sells is out, or estimated to run out within 7 days.");
  });

  it("words one alert the way the owner would say it", () => {
    const [a] = stockoutAlerts([{ ...variant({ i: 1, title: "Ethiopian Coffee 1kg", onHand: 6, sold7: 7, sold30: 30 }) }]);
    expect(alertText(a)).toMatch(/^Ethiopian Coffee 1kg: estimated stockout in \d+ days?$/);
    expect(alertText({ ...a, kind: "out", days: 0 })).toBe("Ethiopian Coffee 1kg: out of stock");
    expect(alertText({ ...a, kind: "soon", days: 0.4 })).toBe("Ethiopian Coffee 1kg: estimated stockout in less than a day");
  });
});

// ---------- backorders and warning levels (D172) ----------

describe("InventoryView with backorders and the owner's own levels", () => {
  const r = report([
    // Sells on backorder, nothing on hand, 4 units owed: out, but worded as what it is, and never a 0 that hides the debt.
    variant({ i: 1, title: "Thermos", onHand: -4, stockPolicy: "continue", owed: 4, sold7: 3, sold30: 9 }),
    // Stops at zero: plain out of stock.
    variant({ i: 2, title: "Plain Mug", onHand: 0, sold7: 3, sold30: 9 }),
    // At its own level of 10, though it would last long at today's pace.
    variant({ i: 3, title: "Tea Tin", onHand: 8, lowStockThreshold: 10, sold7: 1, sold30: 2 }),
    variant({ i: 4, title: "Fine Mug", onHand: 200 }),
  ]);
  const out = view(r);

  it("shows a backorder as out of stock in the counts, words it as on backorder, and shows what is owed", () => {
    expect(r.totals.out).toBe(2);
    expect(r.totals.onBackorder).toBe(1);
    expect(r.totals.owedUnits).toBe(4);
    expect(out).toContain("On backorder");
    expect(out).toContain("4 owed");
    // The figure is shown as it is, a negative one, not as 0.
    expect(words(out)).toContain("-4");
  });

  it("names the alert for a backorder as on backorder, with the owed units, and keeps plain out of stock apart", () => {
    const alerts = stockoutAlerts([variant({ i: 1, title: "Thermos", onHand: -4, stockPolicy: "continue", owed: 4, sold7: 3, sold30: 9 })]);
    expect(alertText(alerts[0])).toBe("Thermos: on backorder, 4 owed");
    expect(alertText({ ...alerts[0], row: { ...alerts[0].row, stockPolicy: "deny" } })).toBe("Thermos: out of stock");
    expect(out).toContain("Thermos: on backorder, 4 owed");
    expect(out).toContain("Plain Mug: out of stock");
  });

  it("counts a negative figure as nothing on hand in the value: it is never a negative value", () => {
    expect(r.totals.value.units).toBe(208);
    expect(r.rows.find((x) => x.sku === "SKU-1")!.valueMinor).toBeNull();
    expect(r.rows.find((x) => x.sku === "SKU-1")!.daysOfStock).toBe(0);
  });

  it("has a card for what is owed that opens the admin's Inventory page, and none for a store that never backorders", () => {
    expect(out).toContain("Owed on backorder");
    expect(out).toContain(`href="${BASE}/inventory?status=backorder"`);
    expect(view(report([variant({ i: 1 }), variant({ i: 2, onHand: 0, sold7: 3, sold30: 9 })]))).not.toContain("Owed on backorder");
  });

  it("calls a variant at its own warning level running low, and says so in the card", () => {
    expect(r.rows.find((x) => x.sku === "SKU-3")!.status).toBe("low");
    expect(r.totals.belowLevel).toBe(1);
    expect(out).toContain("at or below the level you set");
  });

  it("is clean", () => {
    expectClean(out);
  });
});

// ---------- the filter ----------

describe("the status filter", () => {
  const r = normal();

  it("is a row of links with counts, the current one marked", () => {
    const out = view(r, { status: "out" });
    const nav = out.match(/<nav aria-label="Filter by status"[\s\S]*?<\/nav>/)![0];
    expect(nav.match(/<a /g)).toHaveLength(5);
    expect(nav).toMatch(/aria-current="true"[^>]*>[\s\S]*?Out of stock/);
    expect(nav).toContain(`href="${BASE}/analytics/inventory#variants"`);
    expect(nav).toContain(`href="${BASE}/analytics/inventory?status=dead#variants"`);
    expect(words(nav)).toContain("All 5");
  });

  it("shows only the variants in that state", () => {
    const out = view(r, { status: "dead" });
    const table = out.match(/<tbody>[\s\S]*<\/tbody>/)![0];
    expect(table).toContain("Old Mug");
    expect(table).not.toContain("Tea Tin");
    expect(table).not.toContain("Kenya Coffee");
  });

  it("says plainly when none are in that state", () => {
    const calm = report([variant({ i: 1 }), variant({ i: 2 })]);
    expect(view(calm, { status: "out" })).toContain("No variant is out of stock.");
    expect(view(calm, { status: "dead" })).toContain("No variant counts as dead stock.");
    expect(view(calm, { status: "low" })).toContain("No variant is running low.");
    expectClean(view(calm, { status: "out" }));
  });

  it("keeps the sort when the filter changes", () => {
    const out = view(r, { sort: { key: "onHand", dir: "desc" } });
    expect(out).toContain(`href="${BASE}/analytics/inventory?status=out&sort=onHand&dir=desc#variants"`);
  });
});

describe("parseInventoryParams", () => {
  it("reads a status, a column and a direction it knows", () => {
    expect(parseInventoryParams({ status: "low", sort: "days", dir: "desc", limit: "all" })).toEqual({ status: "low", sort: { key: "days", dir: "desc" }, showAll: true });
    expect(parseInventoryParams({ status: ["dead"], sort: ["value"] })).toEqual({ status: "dead", sort: { key: "value", dir: "desc" }, showAll: false });
  });

  it("starts a text column and days left ascending, figures descending, when the direction is missing or wrong", () => {
    expect(parseInventoryParams({ sort: "name" }).sort?.dir).toBe("asc");
    expect(parseInventoryParams({ sort: "days", dir: "up" }).sort?.dir).toBe("asc");
    expect(parseInventoryParams({ sort: "onHand", dir: "up" }).sort?.dir).toBe("desc");
  });

  it("ignores anything else", () => {
    for (const query of [{}, { status: "untracked" }, { status: "drop table", sort: "__proto__", limit: "5" }, { sort: "" }, { status: undefined }]) {
      expect(parseInventoryParams(query)).toEqual({ status: null, sort: null, showAll: false });
    }
  });

  it("knows exactly the columns the table has", () => {
    for (const key of INVENTORY_SORT_KEYS) expect(parseInventoryParams({ sort: key }).sort?.key).toBe(key);
  });
});

// ---------- the sort ----------

describe("sorting", () => {
  const rows = normal().rows;

  it("sorts by any column either way, and not at all without one", () => {
    expect(sortVariants(rows, null).map((r) => r.name)).toEqual(rows.map((r) => r.name));
    expect(sortVariants(rows, { key: "onHand", dir: "desc" })[0].name).toBe("Tea Tin");
    expect(sortVariants(rows, { key: "onHand", dir: "asc" })[0].name).toBe("Kenya Coffee 250g (Whole beans)");
    expect(sortVariants(rows, { key: "name", dir: "asc" })[0].name).toBe("Ethiopian Coffee 1kg");
    expect(sortVariants(rows, { key: "lastSold", dir: "desc" })[0].name).toBe("Old Mug");
  });

  it("puts figures that are not known last whichever way it goes", () => {
    for (const dir of ["asc", "desc"] as const) {
      const order = sortVariants(rows, { key: "days", dir });
      const firstUnknown = order.findIndex((r) => r.daysOfStock === null);
      expect(firstUnknown).toBeGreaterThan(0);
      expect(order.slice(firstUnknown).every((r) => r.daysOfStock === null)).toBe(true);
    }
  });

  it("sorts the table the page draws and marks the column", () => {
    const out = view(normal(), { sort: { key: "onHand", dir: "desc" } });
    const table = out.match(/<tbody>[\s\S]*<\/tbody>/)![0];
    expect(table.indexOf("Tea Tin")).toBeLessThan(table.indexOf("Old Mug"));
    expect(out).toMatch(/<th[^>]*aria-sort="descending"[^>]*>[\s\S]*?On hand/);
    expect(out).toContain(`href="${BASE}/analytics/inventory?sort=onHand&dir=asc#variants"`);
  });

  it("does not change its input, and falls back to the report's order for a column it does not know", () => {
    const before = rows.map((r) => r.variantId);
    expect(sortVariants(rows, { key: "nonsense", dir: "asc" }).map((r) => r.variantId)).toEqual(before);
    sortVariants(rows, { key: "name", dir: "desc" });
    expect(rows.map((r) => r.variantId)).toEqual(before);
  });
});

// ---------- the limit ----------

describe("the table's length", () => {
  const big = report(Array.from({ length: 60 }, (_, i) => variant({ i: i + 1, title: `Variant ${i + 1}` })));

  it(`shows the first ${ROW_LIMIT} and a link to show all`, () => {
    const out = view(big);
    expect(out.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr/g)).toHaveLength(ROW_LIMIT);
    expect(out).toContain("Show all 60 variants");
    expect(out).toContain("limit=all");
  });

  it("shows every row with a link back when asked, and keeps the filter in the link", () => {
    const out = view(big, { showAll: true, status: "ok" });
    expect(out.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr/g)).toHaveLength(60);
    expect(out).toContain(`Show only the first ${ROW_LIMIT}`);
    expect(out).toContain(`href="${BASE}/analytics/inventory?status=ok#variants"`);
  });

  it("offers no toggle for a short table", () => {
    expect(view(normal())).not.toContain("Show all");
  });

  it("builds an address from a state, leaving out what is not set", () => {
    expect(inventoryHref("/p", { status: null, sort: null, showAll: false })).toBe("/p#variants");
    expect(inventoryHref("/p", { status: "low", sort: { key: "days", dir: "asc" }, showAll: true })).toBe("/p?status=low&sort=days&dir=asc&limit=all#variants");
  });
});

// ---------- helpers ----------

describe("helpers", () => {
  it("writes money and the dash", () => {
    expect(moneyOf("NOK", "nb-NO")(12_345)).toMatch(/123,45/);
    for (const bad of [null, undefined, NaN, Infinity]) expect(moneyOf("NOK", "nb-NO")(bad)).toBe(NO_FIGURE);
  });

  it("writes how long stock lasts in whole days, or says it cannot be known", () => {
    expect(daysText(6.2)).toBe("6 days");
    expect(daysText(1)).toBe("1 day");
    expect(daysText(0.3)).toBe("under a day");
    for (const bad of [null, undefined, NaN, Infinity]) expect(daysText(bad)).toBe(NO_FIGURE);
  });

  it("writes units per day with at most two decimals", () => {
    expect(perDayOf()(0.4285714)).toBe("0.43");
    expect(perDayOf()(2)).toBe("2");
    for (const bad of [null, undefined, NaN]) expect(perDayOf()(bad)).toBe(NO_FIGURE);
  });
});
