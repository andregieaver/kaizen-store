import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RefundsReport } from "@/server/analytics-refunds-data";

import { moneyWriter } from "./overview-view";
import { refundCards, RefundsView, type RefundsViewProps } from "./refunds-view";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const text = (props: RefundsViewProps) =>
  renderToString(h(RefundsView, props))
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;

const money = (minor: number) => moneyWriter("NOK", "nb-NO")(minor).replace(/[  ]/g, " ");

const NOT_SEEN = "Refunds made only in Stripe's dashboard are not included: Kaizen only sees refunds made from its own admin, and the reasons are free text.";

function emptyReport(over: Partial<RefundsReport> = {}): RefundsReport {
  return {
    currency: "NOK",
    period: { from: "2026-09-01", to: "2026-10-01", days: 30 },
    refundsMinor: 0,
    refunds: 0,
    refundedOrders: 0,
    revenueMinor: 0,
    orders: 0,
    refundRate: null,
    cohort: { orders: 0, refundedOrders: 0, share: null },
    reasons: [],
    other: { reasons: 0, refunds: 0, valueMinor: 0 },
    products: [],
    productCount: 0,
    productsTruncated: false,
    segments: [
      { segment: "new", label: "New customers", refunds: 0, orders: 0, valueMinor: 0, share: null },
      { segment: "returning", label: "Returning customers", refunds: 0, orders: 0, valueMinor: 0, share: null },
      { segment: "unknown", label: "No customer on the order", refunds: 0, orders: 0, valueMinor: 0, share: null },
    ],
    markets: [],
    notSeen: true,
    notSeenNote: NOT_SEEN,
    unconverted: 0,
    missingRates: [],
    notes: [],
    ...over,
  };
}

function normalReport(over: Partial<RefundsReport> = {}): RefundsReport {
  const total = 480_000;
  return emptyReport({
    refundsMinor: total,
    refunds: 9,
    refundedOrders: 8,
    revenueMinor: 12_000_000,
    orders: 150,
    refundRate: total / 12_000_000,
    cohort: { orders: 150, refundedOrders: 7, share: 7 / 150 },
    reasons: [
      { reason: "wrong size", label: "Wrong size", refunds: 4, valueMinor: 250_000, share: 250_000 / total },
      { reason: "", label: "No reason given", refunds: 2, valueMinor: 120_000, share: 120_000 / total },
      { reason: "<b>broken</b>", label: "<b>broken</b>", refunds: 1, valueMinor: 60_000, share: 60_000 / total },
    ],
    other: { reasons: 2, refunds: 2, valueMinor: 50_000 },
    products: [
      { productId: "p1", name: "Wool sweater", valueMinor: 300_000, refunds: 5, restockedUnits: 4, share: 300_000 / total },
      { productId: null, name: "No product", valueMinor: 30_000, refunds: 1, restockedUnits: 0, share: 30_000 / total },
    ],
    productCount: 14,
    segments: [
      { segment: "new", label: "New customers", refunds: 3, orders: 3, valueMinor: 140_000, share: 140_000 / total },
      { segment: "returning", label: "Returning customers", refunds: 6, orders: 5, valueMinor: 340_000, share: 340_000 / total },
      { segment: "unknown", label: "No customer on the order", refunds: 0, orders: 0, valueMinor: 0, share: 0 },
    ],
    markets: [
      { market: "NO", refunds: 7, orders: 6, valueMinor: 400_000, revenueMinor: 9_000_000, rate: 400_000 / 9_000_000 },
      { market: "SE", refunds: 2, orders: 2, valueMinor: 80_000, revenueMinor: 0, rate: null },
    ],
    ...over,
  });
}

const props = (report: RefundsReport, over: Partial<RefundsViewProps> = {}): RefundsViewProps => ({
  currency: "NOK",
  locale: "nb-NO",
  report,
  marketNames: { NO: "Norway", SE: "Sweden" },
  ...over,
});

describe("refundCards", () => {
  it("shows the amount, the rate against revenue and the share of orders", () => {
    const cards = refundCards(props(normalReport()));
    expect(cards.map((c) => c.label)).toEqual(["Refunded", "Refund rate", "Orders with a refund"]);
    expect(cards[0].value).toBe(money(480_000));
    expect(cards[1].value).toBe("4.0 %");
    expect(cards[2].value).toBe("4.7 %");
    expect(cards[2].hint).toMatch(/7 of 150 orders placed in this period, so far/);
  });

  it("has no refund rate and no order share when nothing was sold, and does not call that 0 %", () => {
    const cards = refundCards(props(emptyReport()));
    expect(cards[1].state).toBe("missing");
    expect(cards[1].value).toBeNull();
    expect(cards[2].state).toBe("missing");
    expect(cards[2].value).toBeNull();
  });

  it("calls sales with no refunds a real 0.0 %", () => {
    const cards = refundCards(props(emptyReport({ revenueMinor: 1_000_000, orders: 10, refundRate: 0, cohort: { orders: 10, refundedOrders: 0, share: 0 } })));
    expect(cards[1].value).toBe("0.0 %");
    expect(cards[0].hint).toMatch(/No refund was made from Kaizen/);
  });

  it("explains each figure in a title", () => {
    for (const c of refundCards(props(normalReport()))) expect(c.help, c.label).toBeTruthy();
  });
});

describe("RefundsView, an empty store", () => {
  const out = text(props(emptyReport()));

  it("is calm: no tables, no chart, no NaN", () => {
    expect(out).toContain("Refunds");
    expect(out).toContain("No refund was made from Kaizen in this period, so there are no reasons, products or markets to show.");
    expect(out).not.toMatch(BAD);
    expect(out).not.toContain("<svg");
    expect(out).not.toContain("<table");
  });

  it("still says that refunds made at the payment provider are not seen", () => {
    expect(out).toContain("Refunds made only at your payment provider are not seen");
    expect(out).toContain(NOT_SEEN);
  });
});

describe("RefundsView, a normal store", () => {
  const out = text(props(normalReport()));

  it("shows the reasons with their amounts, and the grouped rest", () => {
    expect(out).toContain("Wrong size");
    expect(out).toContain("No reason given");
    expect(out).toContain("2 other reasons");
    expect(out).toContain(money(250_000));
  });

  it("shows free text as text, never as markup", () => {
    expect(out).not.toContain("<b>broken</b>");
    expect(out).toContain("&lt;b&gt;broken");
  });

  it("shows the most refunded products, the product count, and a line without a product", () => {
    expect(out).toContain("Wool sweater");
    expect(out).toContain("No product");
    expect(out).toContain("Showing 2 of 14 products");
  });

  it("splits new and returning customers and leaves out an empty unknown row", () => {
    expect(out).toContain("New customers");
    expect(out).toContain("Returning customers");
    expect(out).not.toContain("No customer on the order");
  });

  it("shows the market table with names, and a dash for a market with no revenue", () => {
    expect(out).toContain("Norway");
    expect(out).toContain("Sweden");
    const sweden = out.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*Sweden[\s\S]*?<\/tr>/)![0];
    expect(sweden).toContain("–");
  });

  it("falls back to the market code when it has no name", () => {
    const bare = text(props(normalReport(), { marketNames: undefined }));
    expect(bare).toContain(">NO<");
    expect(bare).not.toMatch(BAD);
  });

  it("shows the unknown row when some refunds have no customer", () => {
    const report = normalReport();
    report.segments[2] = { segment: "unknown", label: "No customer on the order", refunds: 1, orders: 1, valueMinor: 10_000, share: 10_000 / 480_000 };
    expect(text(props(report))).toContain("No customer on the order");
  });

  it("has no NaN, Infinity or undefined, and names every chart and table", () => {
    expect(out).not.toMatch(BAD);
    const lists = [...out.matchAll(/<ol\b[^>]*>/g)].map((m) => m[0]);
    expect(lists.length).toBeGreaterThan(0);
    for (const l of lists) expect(l).toMatch(/aria-label="[^"]{3,}"/);
    const tables = [...out.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => m[0]);
    expect(tables.length).toBe(3);
    for (const t of tables) expect(t).toMatch(/<caption/);
  });

  it("carries the not-seen note above the figures", () => {
    expect(out.indexOf("not seen")).toBeLessThan(out.indexOf("Refunded"));
  });
});

describe("RefundsView, partial currency coverage", () => {
  it("shows the report's note as a warning", () => {
    const note = "2 refunds in SEK are left out: the store has no exchange rate for it.";
    const out = text(props(normalReport({ unconverted: 2, missingRates: ["SEK"], notes: [note] })));
    expect(out).toContain(note);
    expect(out).toContain('data-tone="warning"');
  });
});
