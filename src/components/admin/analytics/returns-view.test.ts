import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { gatedRate, reasonBreakdown, timingOf } from "@/lib/analytics-returns";
import type { ReturnsReport } from "@/server/analytics-returns-data";

import { moneyWriter } from "./overview-view";
import { returnCards, ReturnsView, type ReturnsViewProps } from "./returns-view";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const text = (props: ReturnsViewProps) =>
  renderToString(h(ReturnsView, props))
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;
const money = (minor: number) => moneyWriter("NOK", "nb-NO")(minor).replace(/[  ]/g, " ");

const NOT_SEEN_RETURNS_NOTE = "Returns made without Kaizen's withdrawal function or a return request (a parcel sent back with no message) are not included.";

const noTiming = timingOf([], "a request date");

function emptyReport(over: Partial<ReturnsReport> = {}): ReturnsReport {
  return {
    currency: "NOK",
    period: { from: "2026-09-01", to: "2026-10-01", days: 30 },
    tracked: false,
    windowDays: 14,
    made: { returns: 0, withdrawals: 0, voluntary: 0, units: 0, declined: 0, cancelled: 0 },
    kinds: [
      { kind: "withdrawal", label: "Withdrawals", returns: 0, units: 0, declined: 0, cancelled: 0, refunded: 0, refundedMinor: 0 },
      { kind: "return", label: "Voluntary returns", returns: 0, units: 0, declined: 0, cancelled: 0, refunded: 0, refundedMinor: 0 },
    ],
    cohort: { orders: 0, unitsSold: 0, returnedOrders: 0, returnedUnits: 0 },
    orderRate: gatedRate({ part: 0, whole: 0, min: 30, unit: "orders", tracked: false }),
    unitRate: gatedRate({ part: 0, whole: 0, min: 30, unit: "units", tracked: false }),
    returnedMinor: 0,
    refunded: { minor: 0, returns: 0, outside: 0 },
    reasons: reasonBreakdown([]),
    timing: { requestToRefund: noTiming, receivedToRefund: timingOf([], "the goods received first"), afterDeadline: { late: 0, of: 0 }, truncated: false },
    overdue: 0,
    products: [],
    productCount: 0,
    notSeenNote: NOT_SEEN_RETURNS_NOTE,
    maturity: null,
    unconverted: 0,
    missingRates: [],
    notes: [],
    ...over,
  };
}

function normalReport(over: Partial<ReturnsReport> = {}): ReturnsReport {
  return emptyReport({
    tracked: true,
    made: { returns: 14, withdrawals: 9, voluntary: 5, units: 18, declined: 2, cancelled: 1 },
    kinds: [
      { kind: "withdrawal", label: "Withdrawals", returns: 9, units: 11, declined: 0, cancelled: 1, refunded: 7, refundedMinor: 420_000 },
      { kind: "return", label: "Voluntary returns", returns: 5, units: 7, declined: 2, cancelled: 0, refunded: 3, refundedMinor: 150_000 },
    ],
    cohort: { orders: 120, unitsSold: 200, returnedOrders: 12, returnedUnits: 18 },
    orderRate: gatedRate({ part: 12, whole: 120, min: 30, unit: "orders", tracked: true }),
    unitRate: gatedRate({ part: 18, whole: 200, min: 30, unit: "units", tracked: true }),
    returnedMinor: 690_000,
    refunded: { minor: 570_000, returns: 10, outside: 2 },
    reasons: reasonBreakdown([
      { reason: "too_small", returns: 6, units: 7 },
      { reason: "changed_mind", returns: 4, units: 5 },
      { reason: null, returns: 4, units: 6 },
    ]),
    timing: {
      requestToRefund: timingOf([1, 2, 3, 4, 9], "a request date"),
      receivedToRefund: timingOf([1, 2], "the goods received first"),
      afterDeadline: { late: 1, of: 7 },
      truncated: false,
    },
    overdue: 2,
    products: [
      { productId: "p1", name: "Wool sweater", sold: 40, returnedUnits: 8, returnedMinor: 400_000, rate: gatedRate({ part: 8, whole: 40, min: 20, unit: "units", tracked: true }) },
      { productId: "p2", name: "<b>Tote</b>", sold: 6, returnedUnits: 2, returnedMinor: 30_000, rate: gatedRate({ part: 2, whole: 6, min: 20, unit: "units", tracked: true }) },
    ],
    productCount: 12,
    ...over,
  });
}

const props = (report: ReturnsReport, over: Partial<ReturnsViewProps> = {}): ReturnsViewProps => ({ currency: "NOK", locale: "nb-NO", report, queueHref: "/admin/shop/returns?overdue=1", ...over });

describe("returnCards", () => {
  it("shows the counts, the two rates, the refunded amount, the typical time and the overdue count", () => {
    const cards = returnCards(props(normalReport()));
    expect(cards.map((c) => c.label)).toEqual(["Returns made", "Return rate, orders", "Return rate, units", "Refunded for returns", "Typical time to refund", "Overdue now"]);
    expect(cards[0].value).toBe("14");
    expect(cards[0].hint).toBe("9 withdrawals and 5 voluntary returns.");
    expect(cards[1].value).toBe("10.0 %");
    expect(cards[1].hint).toMatch(/12 of 120 orders with goods, so far/);
    expect(cards[2].value).toBe("9.0 %");
    expect(cards[2].hint).toBe(`18 of 200 units sold, so far; worth ${money(690_000)} without VAT.`);
    expect(cards[3].value).toBe(money(570_000));
    expect(cards[3].hint).toMatch(/10 returns, 2 outside Kaizen's Stripe/);
    expect(cards[4].value).toBe("3 days");
    expect(cards[4].hint).toMatch(/Median of 5 returns; the slowest took 9 days/);
    expect(cards[5].value).toBe("2");
    expect(cards[5].href).toBe("/admin/shop/returns?overdue=1");
  });

  it("shows what is missing in place of a rate for a store that has recorded no return, never 0 %", () => {
    const cards = returnCards(props(emptyReport({ cohort: { orders: 500, unitsSold: 900, returnedOrders: 0, returnedUnits: 0 } })));
    for (const label of ["Return rate, orders", "Return rate, units", "Typical time to refund"]) {
      const c = cards.find((x) => x.label === label)!;
      expect(c.state, label).toBe("missing");
      expect(c.value, label).toBeNull();
      expect(c.missing?.text, label).toBeTruthy();
    }
    expect(cards.find((c) => c.label === "Return rate, orders")!.missing!.text).toContain("No return has been recorded in Kaizen yet");
  });

  it("shows the volume it needs when there are too few orders", () => {
    const report = normalReport({ cohort: { orders: 12, unitsSold: 20, returnedOrders: 1, returnedUnits: 1 }, orderRate: gatedRate({ part: 1, whole: 12, min: 30, unit: "orders", tracked: true }) });
    const c = returnCards(props(report))[1];
    expect(c.state).toBe("missing");
    expect(c.missing!.text).toContain("Only 12 orders");
    expect(c.missing!.text).toContain("at least 30");
  });

  it("says a real zero only for counts", () => {
    const cards = returnCards(props(normalReport({ made: { returns: 0, withdrawals: 0, voluntary: 0, units: 0, declined: 0, cancelled: 0 }, overdue: 0 })));
    expect(cards[0].value).toBe("0");
    expect(cards[0].hint).toBe("No return was made in this period.");
    expect(cards[5].hint).toBe("No withdrawal is past its refund deadline.");
  });

  it("explains each figure in a title", () => {
    for (const c of returnCards(props(normalReport()))) expect(c.help, c.label).toBeTruthy();
  });
});

describe("ReturnsView, a store with no return recorded", () => {
  const out = text(props(emptyReport()));

  it("is calm: a plain sentence, no tables, no chart, no NaN", () => {
    expect(out).toContain("Returns");
    expect(out).toContain("No return has been recorded in Kaizen yet, so there are no rates, reasons or products to show.");
    expect(out).not.toMatch(BAD);
    expect(out).not.toContain("<svg");
    expect(out).not.toContain("<table");
  });

  it("still says that returns made outside Kaizen are not seen", () => {
    expect(out).toContain("Returns made outside Kaizen are not seen");
    expect(out).toContain(NOT_SEEN_RETURNS_NOTE);
  });
});

describe("ReturnsView, a store with returns but none in this period", () => {
  it("says so rather than showing empty tables", () => {
    const out = text(props(emptyReport({ tracked: true })));
    expect(out).toContain("No return was made or refunded in this period");
    expect(out).not.toContain("<table");
    expect(out).not.toMatch(BAD);
  });
});

describe("ReturnsView, a normal store", () => {
  const out = text(props(normalReport()));

  it("shows the reasons with counts, and the missing reasons as their own row", () => {
    expect(out).toContain("Too small");
    expect(out).toContain("Changed their mind");
    expect(out).toContain("No reason given");
    expect(out).toContain("10 of 14 returns have a reason");
  });

  it("splits withdrawals and voluntary returns, with a dash where a withdrawal cannot be declined", () => {
    expect(out).toContain("Withdrawals");
    expect(out).toContain("Voluntary returns");
    const row = out.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*Withdrawals[\s\S]*?<\/tr>/)![0];
    expect(row).toContain("–");
  });

  it("shows the times with the median and the slowest, and a dash with the reason where there are too few", () => {
    expect(out).toContain("Request to refund");
    expect(out).toContain("Goods received to refund");
    expect(out).toContain("1 of 7 withdrawals were refunded after the 14-day deadline");
    const received = out.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*Goods received to refund[\s\S]*?<\/tr>/)![0];
    expect(received).toContain("–");
    expect(received).toContain("Only 2 returns refunded");
  });

  it("shows the most returned products and the rate only where enough were sold", () => {
    expect(out).toContain("Wool sweater");
    expect(out).toContain("20.0 %");
    const tote = out.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*Tote[\s\S]*?<\/tr>/)![0];
    expect(tote).toContain("–");
    expect(tote).toContain("Only 6 units");
    expect(out).toContain("Showing 2 of 12 products");
  });

  it("shows free text as text, never as markup", () => {
    expect(out).not.toContain("<b>Tote</b>");
    expect(out).toContain("&lt;b&gt;Tote");
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

  it("shows the maturity and rate notes when there are any", () => {
    const noted = text(props(normalReport({ maturity: "Orders from the last 14 days can still be returned, so the rates for this period are still rising and are not final.", notes: ["1 order in SEK is left out: the store has no exchange rate for it."] })));
    expect(noted).toContain("still rising and are not final");
    expect(noted).toContain("no exchange rate");
  });
});
