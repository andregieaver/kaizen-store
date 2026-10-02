import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Alert } from "@/lib/analytics-alerts";
import { explainChange } from "@/lib/analytics-diagnosis";
import { forecastMonth } from "@/lib/analytics-forecast";
import { derive, EMPTY_TOTALS, KPI_CARDS, type KpiId, type Totals } from "@/lib/analytics-kpi";
import { lastYearOf, parseAnalyticsParams, previousPeriodOf } from "@/lib/analytics-period";
import { targetProgress } from "@/lib/analytics-targets";
import { channelTable, funnel, UNKNOWN_CHANNEL, type ChannelInput } from "@/lib/analytics-traffic";
import type { OverviewData, PeriodFigures, SeriesPoint } from "@/server/analytics-totals";
import type { MarketingReport, TrafficReport } from "@/server/analytics-traffic-data";

import {
  dayText,
  factorRows,
  forecastLines,
  formatTimes,
  moneyLines,
  moneyWriter,
  OverviewView,
  targetLines,
  type OverviewDiagnosis,
  type OverviewForecast,
  type OverviewViewProps,
} from "./overview-view";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ");

const NOW = new Date("2026-10-15T10:00:00Z");
const BASE = "/admin/shop";
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
const writer = moneyWriter("NOK", "nb-NO");
const money = (minor: number) => plain(writer(minor));
const parsed = (query: Record<string, string> = {}) => parseAnalyticsParams(query, { now: NOW, timeZone: "Europe/Oslo" });

// ---------- fixtures ----------

const totals = (over: Partial<Totals> = {}): Totals => ({ ...EMPTY_TOTALS, ...over });
const figures = (period: PeriodFigures["period"], t: Totals, visitsFrom: string | null = null): PeriodFigures => ({ period, totals: t, derived: derive(t, { fixedCostsMonthlyMinor: 0 }, period.days), visitsFrom });

const NORMAL = totals({
  orders: 40,
  grossSalesMinor: 1_400_000,
  discountsMinor: 200_000,
  vatMinor: 300_000,
  revenueMinor: 1_200_000,
  refundsMinor: 50_000,
  cogsMinor: 400_000,
  knownCostRevenueMinor: 1_200_000,
  paymentFeesMinor: 20_000,
  platformFeesMinor: 10_000,
  shippingCostsMinor: 8_000,
  marketingMinor: 100_000,
  sessions: 2000,
  newCustomers: 25,
  returningCustomers: 10,
  units: 70,
});
const EARLIER = totals({ ...NORMAL, orders: 30, revenueMinor: 1_000_000, refundsMinor: 20_000, cogsMinor: 350_000, knownCostRevenueMinor: 1_000_000, sessions: 1800, units: 55 });

const point = (i: number, over: Partial<SeriesPoint> = {}): SeriesPoint => ({
  key: `2026-10-${String(10 + i).padStart(2, "0")}`,
  label: `${10 + i} Oct`,
  from: `2026-10-${String(10 + i).padStart(2, "0")}`,
  to: `2026-10-${String(11 + i).padStart(2, "0")}`,
  orders: 8,
  revenueMinor: 240_000,
  refundsMinor: 10_000,
  netRevenueMinor: 230_000,
  cogsMinor: 80_000,
  grossProfitMinor: 150_000,
  contributionMinor: 120_000 + i * 1000,
  newCustomers: 5,
  returningCustomers: 2,
  ...over,
});

const sparklines = (): Record<KpiId, (number | null)[]> => Object.fromEntries(KPI_CARDS.map((c) => [c.id, [1, 2, 3, 2, 4]])) as Record<KpiId, (number | null)[]>;

type OverviewOptions = { current?: Totals; previous?: Totals; lastYear?: Totals; query?: Record<string, string>; visitsFrom?: string | null; over?: Partial<OverviewData> };

function overview({ current = NORMAL, previous = EARLIER, lastYear = EARLIER, query, visitsFrom = null, over = {} }: OverviewOptions = {}): OverviewData {
  const params = parsed(query);
  const cur = figures(params.period, current, visitsFrom);
  const empty = current.orders === 0 && current.revenueMinor === 0;
  const points = Array.from({ length: 5 }, (_, i) => (empty ? point(i, { orders: 0, revenueMinor: 0, refundsMinor: 0, netRevenueMinor: 0, cogsMinor: 0, grossProfitMinor: null, contributionMinor: null }) : point(i)));
  return {
    params,
    currency: "NOK",
    settings: { paymentFeeBps: 140, paymentFeeFixedMinor: 180, shippingCostMinor: 5000, fixedCostsMonthlyMinor: 0, ltvLifespanYears: 3, saved: true, updatedAt: "2026-10-01T00:00:00.000Z" },
    bucket: "day",
    current: cur,
    previous: figures(previousPeriodOf(params.period), previous),
    lastYear: figures(lastYearOf(params.period), lastYear),
    series: { current: points, comparison: params.compare.mode === "none" ? null : points.map((p) => ({ ...p, netRevenueMinor: 200_000, contributionMinor: 100_000 })) },
    sparklines: sparklines(),
    topProducts: {
      byRevenue: [
        { productId: "p1", name: "Linen shirt", revenueMinor: 500_000, units: 20, profitMinor: 300_000, costCoverage: 1 },
        { productId: "p2", name: "Wool scarf", revenueMinor: 300_000, units: 15, profitMinor: 120_000, costCoverage: 0.6 },
      ],
      byProfit: [
        { productId: "p1", name: "Linen shirt", revenueMinor: 500_000, units: 20, profitMinor: 300_000, costCoverage: 1 },
        { productId: "p2", name: "Wool scarf", revenueMinor: 300_000, units: 15, profitMinor: 120_000, costCoverage: 0.6 },
      ],
      truncated: false,
    },
    unconverted: 0,
    missingCurrencies: [],
    notes: [],
    costCoverageText: cur.derived.costCoverage === null ? "no sales yet" : `based on ${Math.round(cur.derived.costCoverage * 100)} % of sales`,
    costCoverage: cur.derived.costCoverage,
    ...over,
  };
}

const coverageOn = { counting: true, firstDay: "2026-01-01", partial: false, from: "2026-09-16", to: "2026-10-16", days: 30 };
const coverageOff = { counting: false, firstDay: null, partial: false, from: null, to: null, days: 0 };

function traffic(on = true, over: Partial<TrafficReport> = {}): TrafficReport {
  const counts = on ? { sessions: 2000, productViewers: 1400, carts: 300, checkouts: 120, purchases: 40 } : { sessions: null, productViewers: null, carts: null, checkouts: null, purchases: null };
  return {
    currency: "NOK",
    counting: on,
    coverage: on ? coverageOn : coverageOff,
    sessions: on ? 2000 : null,
    funnel: funnel(counts),
    conversion: { orders: on ? 40 : 0, sessions: on ? 2000 : null, rate: on ? 0.02 : null },
    byDevice: [],
    byMarket: [],
    landingPages: [],
    landingTruncated: false,
    unknownOrders: { orders: 0, revenueMinor: 0 },
    uncoveredOrders: { orders: 0, revenueMinor: 0 },
    unconverted: 0,
    missingCurrencies: [],
    notes: [],
    ...over,
  };
}

const channelInputs: ChannelInput[] = [
  { channel: "organic_search", sessions: 800, orders: 16, revenueMinor: 480_000, newCustomers: 10, spendMinor: 0, contributionBeforeMarketingMinor: 300_000 },
  { channel: "paid_search", sessions: 500, orders: 12, revenueMinor: 400_000, newCustomers: 9, spendMinor: 100_000, contributionBeforeMarketingMinor: 250_000 },
  { channel: "email", sessions: 200, orders: 8, revenueMinor: 250_000, newCustomers: 2, spendMinor: 0, contributionBeforeMarketingMinor: 150_000 },
  { channel: UNKNOWN_CHANNEL, sessions: null, orders: 4, revenueMinor: 70_000, newCustomers: 4, spendMinor: 0, contributionBeforeMarketingMinor: 40_000 },
];

function marketing(on = true, over: Partial<MarketingReport> = {}): MarketingReport {
  return {
    currency: "NOK",
    counting: on,
    coverage: on ? coverageOn : coverageOff,
    table: on ? channelTable(channelInputs) : null,
    spend: { totalMinor: on ? 100_000 : 0, byChannel: [], outsideCoverageMinor: 0 },
    unknownOrders: { orders: 0, revenueMinor: 0 },
    uncoveredOrders: { orders: 0, revenueMinor: 0 },
    unconverted: 0,
    missingCurrencies: [],
    notes: [],
    ...over,
  };
}

const target = (targetMinor: number | null, actualMinor = 900_000, today = "2026-10-15", todayShare = 0.4) => ({
  monthLabel: "October 2026",
  progress: targetProgress({ targetMinor, actualMinor, monthStart: "2026-10-01", today, todayShare }),
});

function view(over: Partial<OverviewViewProps> = {}): string {
  return html(
    h(OverviewView, {
      base: BASE,
      currency: "NOK",
      locale: "nb-NO",
      isOwner: true,
      data: overview(),
      traffic: traffic(),
      marketing: marketing(),
      target: target(2_000_000),
      alerts: [],
      forecast: null,
      diagnosis: null,
      ...over,
    }),
  );
}

/** An alert as the engine gives it (`alertsFor()`), its link a path after the store's admin base. */
const alert = (over: Partial<Alert> = {}): Alert => ({ id: "conversion-drop", severity: "warning", text: "Conversion fell this week.", href: "/analytics/traffic", action: "See where it fell", evidence: [], size: 1, ...over });

/** A forecast with a month's history behind it, as `forecastMonth()` gives it; `over` replaces what the test needs to say otherwise. */
function forecast(targetMinor: number | null, over: Partial<OverviewForecast["forecast"]> = {}): OverviewForecast {
  const history = Array.from({ length: 56 }, (_, i) => ({ day: new Date(Date.UTC(2026, 8, 9 + i)).toISOString().slice(0, 10), value: 20_000 }));
  return { monthLabel: "October 2026", targetMinor, forecast: { ...forecastMonth({ monthStart: "2026-10-01", today: "2026-10-04", dailyHistory: history }), ...over } };
}

/** An explanation of a fall in conversion with visits counted, as `explainChange()` gives it. */
function diagnosis(over: Partial<OverviewDiagnosis> = {}): OverviewDiagnosis {
  return {
    explanation: explainChange({ current: { revenueMinor: 880_000, orders: 44, sessions: 2000 }, previous: { revenueMinor: 1_000_000, orders: 50, sessions: 1800 }, currency: "NOK", locale: "nb-NO" }),
    comparedWith: "the previous period (1 – 30 Sep 2026)",
    basis: "Revenue before refunds, without VAT",
    notes: [],
    ...over,
  };
}

/** A store with no orders, no costs and no visit counting, as a new store is. */
const emptyStore = (over: Partial<OverviewViewProps> = {}) =>
  view({ data: overview({ current: totals(), previous: totals(), lastYear: totals(), over: { topProducts: { byRevenue: [], byProfit: [], truncated: false } } }), traffic: traffic(false), marketing: marketing(false), target: target(null, 0), ...over });

/** No figure may ever be printed as one of these. */
const BAD = /NaN|Infinity|undefined|\[object|\bnull\b/;

const accessibleNames = (out: string) => {
  const svgs = [...out.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]);
  const images = svgs.filter((s) => /role="img"/.test(s));
  const lists = [...out.matchAll(/<ol\b[^>]*>/g)].map((m) => m[0]);
  const meters = [...out.matchAll(/<[a-z]+\b[^>]*role="meter"[^>]*>/g)].map((m) => m[0]);
  const emptyCharts = [...out.matchAll(/<div role="img"[^>]*>/g)].map((m) => m[0]);
  return { images, lists, meters, emptyCharts };
};

// ---------- the pieces ----------

describe("helpers", () => {
  it("writes whole and in-between amounts without refusing", () => {
    expect(money(123_456)).toBe("1 234,56 kr");
    expect(money(12.5)).toMatch(/kr$/);
  });

  it("writes days and returns on spend, and no figure for what it cannot", () => {
    expect(dayText("2026-10-03")).toBe("3 Oct 2026");
    expect(dayText("not a day")).toBe("not a day");
    expect(formatTimes(3.24)).toBe("3.2×");
    expect(formatTimes(null)).toBe("–");
    expect(formatTimes(Number.NaN)).toBe("–");
  });

  it("words what the money is, with the change against what the address compares with", () => {
    const lines = moneyLines(overview(), money);
    expect(lines[0]).toBe("40 paid orders brought in 11 500,00 kr after refunds, up 17.3 % on the previous period.");
    expect(lines[1]).toContain("about 6 120,00 kr is left (based on 100 % of sales)");
    expect(moneyLines(overview({ query: { compare: "year" } }), money)[0]).toContain("on the same period last year");
    expect(moneyLines(overview({ query: { compare: "none" } }), money)[0]).not.toContain(" on ");
  });

  it("calls a shortfall a shortfall and says when profit cannot be known", () => {
    const loss = totals({ ...NORMAL, cogsMinor: 1_300_000 });
    expect(moneyLines(overview({ current: loss }), money)[1]).toMatch(/the store is about .* short/);
    const unknown = totals({ ...NORMAL, cogsMinor: 0, knownCostRevenueMinor: 0 });
    const lines = moneyLines(overview({ current: unknown }), money);
    expect(lines[1]).toContain("profit cannot be shown");
    expect(lines.join(" ")).not.toMatch(/left|short/);
  });

  it("says nothing sold rather than writing a zero", () => {
    const lines = moneyLines(overview({ current: totals(), previous: totals() }), money);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("No orders were paid in this period yet");
  });

  it("words a target from the figures: ahead, behind, early, reached", () => {
    const behind = targetLines(target(2_000_000, 500_000).progress, money);
    expect(behind.join(" ")).toContain("less than the");
    expect(behind.join(" ")).toContain("That is an estimate.");
    const ahead = targetLines(target(2_000_000, 1_500_000).progress, money);
    expect(ahead.join(" ")).toContain("more than the");
    const early = targetLines(target(2_000_000, 0, "2026-10-01", 0.2).progress, money);
    expect(early.join(" ")).toContain("early in the month");
    expect(early.join(" ")).not.toContain("estimate");
    expect(targetLines(target(2_000_000, 2_100_000).progress, money)[0]).toBe("The target is reached.");
    expect(targetLines(target(null).progress, money)).toEqual([]);
  });
});

// ---------- the page body ----------

describe("OverviewView: a normal store", () => {
  const out = view({ alerts: [alert()] });

  it("answers 'are we making money?' first, with the sentence and twelve cards that link to their pages", () => {
    expect(out).toContain("Are we making money?");
    expect(out).toContain("40 paid orders brought in");
    for (const card of KPI_CARDS) {
      expect(out).toContain(card.label);
      expect(out).toContain(`href="${BASE}/analytics/${card.page}"`);
    }
    expect(out.match(/data-state="ok"/g)).toHaveLength(12);
    // The first four are the main ones.
    expect(out.match(/text-3xl/g)).toHaveLength(4);
    expect(out.indexOf("Revenue")).toBeLessThan(out.indexOf("Average order value"));
  });

  it("puts the needs-you-today slot above the cards, its link made from the store's admin address and the alert's own path", () => {
    expect(out).toContain("Conversion fell this week.");
    expect(out).toContain(`href="${BASE}/analytics/traffic"`);
    expect(out.indexOf("Needs you today")).toBeLessThan(out.indexOf("Are we making money?"));
  });

  it("shows each change against the previous period and last year, with arrows and words", () => {
    expect(out).toContain("vs previous period");
    expect(out).toContain("vs same period last year");
    expect(out).toContain("+17.3 %");
    expect(out).toMatch(/Up, better: /);
  });

  it("explains each figure's meaning in a tooltip and the profit cards' coverage in a hint", () => {
    expect(out).toContain('title="Paid orders divided by visits, over the days both are counted."');
    expect(out).toContain("based on 100 % of sales");
  });

  it("draws net revenue and contribution profit with the comparison dashed", () => {
    expect(out).toContain('aria-label="Net revenue per day"');
    expect(out).toContain('aria-label="Contribution profit per day"');
    expect(out).toContain('stroke-dasharray="4 3"');
    expect(out).toContain("Previous period");
    expect(out).not.toContain("Add what your products cost to see profit");
  });

  it("draws the funnel with its five rates", () => {
    expect(out).toContain('aria-label="Sales funnel"');
    for (const label of ["Visits", "Viewed a product", "Added to cart", "Reached checkout", "Purchased"]) expect(out).toContain(label);
    for (const label of ["Product view rate", "Add-to-cart rate", "Cart abandonment", "Checkout abandonment", "Purchase conversion"]) expect(out).toContain(label);
    expect(out).toContain("70.0 %"); // product view rate 1400 / 2000
    expect(out).toContain("86.7 %"); // cart abandonment 1 - 40 / 300
  });

  it("ranks the best sellers by revenue and by profit, and the top channels with ROAS", () => {
    expect(out).toContain('aria-label="Top products by revenue"');
    expect(out).toContain('aria-label="Top products by profit"');
    expect(out).toContain("Linen shirt");
    expect(out).toContain("20 sold");
    expect(out).toContain("60 % costed");
    expect(out).toContain("Top channels by revenue");
    expect(out).toContain("Organic search");
    expect(out).toContain("4.0×"); // paid search: 400 000 / 100 000
    expect(out).toContain(`href="${BASE}/analytics/marketing"`);
  });

  it("shows target progress with the expected figure, the estimate and the pace in words", () => {
    expect(out).toContain("Target for October 2026");
    expect(out).toMatch(/role="meter"[^>]*aria-label="Net revenue against the target for October 2026"/);
    expect(out).toContain("Expected by today");
    expect(out).toContain("If the pace holds");
  });

  it("has an accessible name on every chart and never prints a missing figure as one", () => {
    const { images, lists, meters } = accessibleNames(out);
    expect(images.length).toBeGreaterThanOrEqual(2);
    for (const svg of images) expect(svg).toMatch(/aria-label="[^"]+"/);
    for (const ol of lists) expect(ol).toMatch(/aria-label="[^"]+"/);
    expect(meters).toHaveLength(1);
    expect(out).not.toMatch(BAD);
  });

  it("leaves the comparison out when none is chosen", () => {
    const none = view({ data: overview({ query: { compare: "none" } }) });
    expect(none).not.toContain("vs previous period");
    expect(none).not.toContain("vs same period last year");
    expect(none).not.toContain('stroke-dasharray="4 3"');
    expect(none).not.toMatch(BAD);
  });

  it("is a page of server markup: links and forms only, no inline script", () => {
    expect(out).not.toContain("<script");
    expect(out).not.toMatch(/\son[a-z]+="/);
  });
});

describe("OverviewView: a store with no orders", () => {
  const out = emptyStore();

  it("is calm: plain empty states, no NaN, Infinity or undefined anywhere", () => {
    expect(out).not.toMatch(BAD);
    expect(out).toContain("No orders were paid in this period yet");
    expect(out).toContain("No sales in this period yet");
    expect(out).toContain("No products were sold in this period.");
  });

  it("shows no profit or margin as zero, and no change against nothing", () => {
    expect(out.match(/data-state="missing"/g)!.length).toBeGreaterThanOrEqual(5);
    expect(out).toContain("No orders in this period yet.");
    expect(out).not.toContain("▲");
    expect(out).not.toContain("▼");
  });

  it("asks gently for visit counting and a target instead of drawing empty charts", () => {
    expect(out).toContain("Turn on visit counting");
    expect(out).toContain(`href="${BASE}/analytics/settings"`);
    expect(out).toContain("No target is set for October 2026");
    expect(out).toContain("Set a monthly target");
    expect(out).not.toContain('role="meter"');
  });

  it("still names every chart that is drawn", () => {
    const { images, lists, emptyCharts } = accessibleNames(out);
    for (const e of [...images, ...lists, ...emptyCharts]) expect(e).toMatch(/aria-label="[^"]+"/);
    expect(out).toContain('aria-label="Top products by revenue: No products were sold in this period."');
  });
});

describe("OverviewView: costs and coverage", () => {
  const unknownCosts = totals({ ...NORMAL, cogsMinor: 0, knownCostRevenueMinor: 0 });
  const data = overview({ current: unknownCosts, over: { topProducts: { byRevenue: overview().topProducts.byRevenue, byProfit: [], truncated: false } } });

  it("asks for the costs instead of showing a zero profit", () => {
    const out = view({ data });
    expect(out).toContain("Add what your products cost to see profit");
    expect(out).not.toContain('aria-label="Contribution profit per day"');
    expect(out).toContain("Add what your products cost to rank them by profit");
    expect(out).toContain("profit cannot be shown");
    // Gross profit and gross margin are not available, with the way to fix it.
    expect(out.match(/Needs product costs\./g)!.length).toBe(2);
    expect(out).toContain(`href="${BASE}/analytics/settings"`);
    expect(out).not.toMatch(BAD);
  });

  it("does not send a member who is not an owner to the owner's settings", () => {
    const out = view({ data, isOwner: false });
    expect(out).not.toContain("/analytics/settings");
    expect(out).toContain("An owner of the store can add them.");
    expect(out).not.toMatch(BAD);
  });

  it("says profit is estimated from the share of sales whose cost is known, and warns when a good part has no cost", () => {
    const partial = totals({ ...NORMAL, knownCostRevenueMinor: 744_000 });
    const out = view({ data: overview({ current: partial }) });
    expect(out).toContain("based on 62 % of sales");
    expect(out).toContain("Profit figures are estimated from the 62 % of sales whose cost is known");
    // The caveat sits under the answer it qualifies, not between the page's title and the answer.
    expect(out.indexOf("Are we making money?")).toBeLessThan(out.indexOf("Profit figures are estimated from the 62 % of sales"));
    // The answer itself says it is an estimate.
    expect(out).toContain("(estimated from the 62 % of sales whose cost is known)");
    const full = view();
    expect(full).not.toContain("Profit figures are estimated");
    expect(full).not.toContain("estimated from the");
  });

  it("shows no profit under 30 % of sales with a known cost, and says how few are known", () => {
    const few = totals({ ...NORMAL, knownCostRevenueMinor: 288_000 }); // 24 % of 1 200 000
    const out = view({ data: overview({ current: few }) });
    expect(out).toContain("Product costs are known for only 24 % of sales, too few to estimate profit from");
    expect(out).toContain("Add what the rest cost to see how much of this is yours to keep.");
    expect(out).not.toContain("Profit figures are estimated");
  });

  it("warns that unset fees count as nothing, for owners with the link and for others without", () => {
    const unsaved = overview({ over: { settings: { ...overview().settings, saved: false, updatedAt: null } } });
    const owner = view({ data: unsaved });
    expect(owner).toContain("not entered, so they count as nothing");
    expect(owner).toContain("Enter them in Analytics settings");
    const staff = view({ data: unsaved, isOwner: false });
    expect(staff).toContain("An owner can enter them in Analytics settings.");
    expect(staff).not.toContain("/analytics/settings");
  });
});

describe("OverviewView: visits and currencies", () => {
  it("says when visit counting began inside the period and what that covers", () => {
    const data = overview({ visitsFrom: "2026-10-03" });
    const out = view({ data, traffic: traffic(true, { coverage: { ...coverageOn, firstDay: "2026-10-03", partial: true }, uncoveredOrders: { orders: 5, revenueMinor: 100_000 } }) });
    expect(out).toContain("Visits have been counted since 3 Oct 2026, so conversion and the per-visit figures cover only the days from then.");
    expect(out).toContain("Counted since 3 Oct 2026");
    expect(out).toContain("so the funnel covers only the days from then.");
    expect(out).toContain("5 paid orders fall outside the days with counted visits and are left out of the rates.");
    expect(out).not.toMatch(BAD);
  });

  it("says no visit was counted when counting is on but the period has none", () => {
    const quiet = traffic(true, { sessions: null, funnel: funnel({ sessions: null, productViewers: null, carts: null, checkouts: null, purchases: null }) });
    const data = overview({ current: totals({ ...NORMAL, sessions: null }) });
    const out = view({ data, traffic: quiet, marketing: marketing(true, { table: null }) });
    expect(out).toContain("No visits were counted in this period, so there is no funnel to show yet.");
    expect(out).toContain("No visits were counted in this period, so orders cannot be tied to a channel yet.");
    expect(out).toContain("No visits were counted in this period.");
    expect(out).not.toContain("Turn on visit counting");
    expect(out).not.toMatch(BAD);
  });

  it("explains visit counting to a member who cannot switch it on, without a dead link", () => {
    const out = emptyStore({ isOwner: false });
    expect(out).toContain("An owner of the store can switch it on in Analytics settings.");
    expect(out).toContain("Visit counting is off. An owner can switch it on in Analytics settings.");
    expect(out).not.toContain("/analytics/settings");
    expect(out).not.toContain("Set a monthly target");
  });

  it("repeats the note about orders left out for a currency with no rate", () => {
    const note = "3 orders and refunds in SEK are left out of these figures because the store has no rate to NOK. Set the rate under Languages and currencies.";
    const out = view({ data: overview({ over: { notes: [note], unconverted: 3, missingCurrencies: ["SEK"] } }) });
    expect(out).toContain(note);
    expect(out).toContain('role="note"');
  });

  it("shows no return on spend where none is entered, with the reason", () => {
    const none = channelTable(channelInputs.map((c) => ({ ...c, spendMinor: 0 })));
    const out = view({ marketing: marketing(true, { table: none, spend: { totalMinor: 0, byChannel: [], outsideCoverageMinor: 0 } }) });
    expect(out).toContain("No ad spend is entered for this period.");
    expect(out).toContain('title="No ad spend entered for this channel"');
    expect(out).not.toContain("×</td>");
    expect(out).not.toMatch(BAD);
  });
});

describe("OverviewView: targets", () => {
  it("says behind in amounts and keeps the pace word in the meter", () => {
    const out = view({ target: target(2_000_000, 400_000) });
    expect(out).toContain("less than the");
    expect(out).toContain("Behind pace");
  });

  it("says ahead, and counts the days left", () => {
    const out = view({ target: target(2_000_000, 1_600_000) });
    expect(out).toContain("more than the");
    expect(out).toContain("Ahead of pace");
    expect(out).toContain("16 days left this month.");
  });

  it("gives no verdict early in the month", () => {
    const out = view({ target: target(2_000_000, 0, "2026-10-01", 0.1) });
    expect(out).toContain("It is early in the month");
    expect(out).not.toContain("Behind pace");
    expect(out).not.toMatch(BAD);
  });
});

// ---------- the forecast and the diagnosis ----------

describe("forecastLines", () => {
  it("says where the month is heading, with its range, and that it is an estimate", () => {
    const lines = forecastLines(forecast(null), money);
    expect(lines[0]).toMatch(/^October is heading for about .+, likely .+ to .+ \(an estimate\)\.$/);
    expect(lines.join(" ")).toContain("So far:");
    expect(lines.join(" ")).not.toContain("target");
  });

  it("compares with the target: on track when it is within reach, and where the range stands against it", () => {
    // A flat history has no spread, so the range is given a width here, as a real month's would have.
    const flat = forecast(null);
    const expected = flat.forecast.expectedMinor as number;
    const f = forecast(null, { lowMinor: Math.round(expected * 0.9), highMinor: Math.round(expected * 1.1) });
    const on = forecastLines({ ...f, targetMinor: Math.round(expected / 0.99) }, money);
    expect(on[0]).toContain("October is on track for about");
    expect(on[1]).toMatch(/That is 99 % of the .+ target\. The target is inside the range\./);
    const short = forecastLines({ ...f, targetMinor: Math.round(expected * 3) }, money);
    expect(short[0]).toContain("heading for about");
    expect(short[1]).toContain("Even the high end of the range falls short of the target.");
    const easy = forecastLines({ ...f, targetMinor: Math.round(expected / 3) }, money);
    expect(easy[1]).toContain("Even the low end of the range reaches the target.");
  });

  it("is honest about too little history: no figure, the reason, and what is banked so far", () => {
    const thin = forecast(2_000_000, { expectedMinor: null, lowMinor: null, highMinor: null, basis: "too-little-data", soFarMinor: 45_000, notes: ["Fewer than 14 days of sales before today, too little to forecast the month."] });
    const lines = forecastLines(thin, money);
    expect(lines[0]).toBe("There is too little history to forecast October yet.");
    expect(lines[1]).toContain("Fewer than 14 days");
    expect(lines[2]).toContain("So far this month:");
    expect(lines.join(" ")).not.toMatch(BAD);
    // Nothing banked yet: no line about it, not a zero.
    expect(forecastLines(forecast(null, { expectedMinor: null, lowMinor: null, highMinor: null, basis: "too-little-data", soFarMinor: 0, notes: [] }), money)).toEqual(["There is too little history to forecast October yet."]);
  });
});

describe("factorRows", () => {
  it("draws each factor's own change, signed, with its part of the change", () => {
    const rows = factorRows(diagnosis().explanation);
    expect(rows.map((r) => r.label)).toEqual(["Traffic", "Conversion", "Average order"]);
    // Conversion fell (44 of 2 000 against 50 of 1 800), traffic rose.
    expect(rows.find((r) => r.label === "Traffic")!.value as number).toBeGreaterThan(0);
    expect(rows.find((r) => r.label === "Conversion")!.value as number).toBeLessThan(0);
    expect(rows.find((r) => r.label === "Conversion")!.valueText).toMatch(/^[-−]/);
    expect(rows.map((r) => r.detail).join(" ")).toMatch(/\d+ % of the change/);
  });
});

describe("OverviewView: the forecast and why sales changed", () => {
  it("leaves both out when they could not be worked out", () => {
    const out = view();
    expect(out).not.toContain("Why did sales change?");
    expect(out).not.toContain("Forecast for");
  });

  it("draws the forecast under the target, labelled an estimate", () => {
    const out = view({ forecast: forecast(2_000_000) });
    expect(out).toContain("Forecast for October 2026");
    expect(out).toContain("Estimate");
    expect(out).toContain("(an estimate)");
    expect(out.indexOf("Target for October 2026")).toBeLessThan(out.indexOf("Forecast for October 2026"));
    expect(out).not.toMatch(BAD);
  });

  it("draws the explanation: the sentences, the factor bars, the change in kroner and the place to look", () => {
    const d = diagnosis();
    const out = view({ diagnosis: d });
    expect(out).toContain("Why did sales change?");
    expect(out).toContain("against the previous period (1 – 30 Sep 2026)");
    expect(out).toContain("Revenue before refunds, without VAT");
    expect(out).toContain('aria-label="Change in each factor"');
    for (const sentence of d.explanation.sentences) expect(out).toContain(sentence.replace(/&/g, "&"));
    expect(out).toContain("Change in revenue:");
    expect(out).toContain("−");
    expect(out.indexOf("Are we making money?")).toBeLessThan(out.indexOf("Why did sales change?"));
    expect(out.indexOf("Why did sales change?")).toBeLessThan(out.indexOf("Sales and profit over time"));
    expect(out).not.toMatch(BAD);
  });

  it("keeps the chosen period and comparison in every drill-down link, so the page opened shows what the card showed", () => {
    const query = { period: "year", compare: "year" };
    const d = diagnosis();
    const out = view({ data: overview({ query }), diagnosis: d });
    const kept = "period=year&compare=year";
    for (const card of KPI_CARDS) expect(out).toContain(`href="${BASE}/analytics/${card.page}?${kept}"`);
    for (const page of ["traffic", "products", "marketing"]) expect(out).toContain(`href="${BASE}/analytics/${page}?${kept}"`);
    expect(out).toContain(`href="${BASE}${d.explanation.lookAt!.href}?${kept}"`);
    // No link to another analytics page drops them (settings has no period).
    const links = [...out.matchAll(/href="([^"]*\/analytics\/[^"#]*)"/g)].map((m) => m[1]).filter((h) => !h.endsWith("/analytics/settings"));
    expect(links.length).toBeGreaterThan(12);
    for (const href of links) expect(href).toContain(kept);
  });

  it("keeps a custom range in the links too, and leaves the default view's links clean", () => {
    const custom = view({ data: overview({ query: { period: "custom", from: "2026-09-01", to: "2026-09-10", compare: "none" } }) });
    expect(custom).toContain(`href="${BASE}/analytics/finance?period=custom&from=2026-09-01&to=2026-09-10&compare=none"`);
    expect(view()).toContain(`href="${BASE}/analytics/finance"`);
  });

  it("links the place to look from the store's admin address", () => {
    const d = diagnosis();
    const lookAt = d.explanation.lookAt;
    expect(lookAt).not.toBeNull();
    const out = view({ diagnosis: d });
    expect(out).toContain(`href="${BASE}${lookAt!.href}"`);
    expect(out).toContain(lookAt!.text);
  });

  it("says why nothing can be explained instead of drawing bars", () => {
    const none = diagnosis({ explanation: explainChange({ current: { revenueMinor: 0, orders: 0, sessions: null }, previous: { revenueMinor: 0, orders: 0, sessions: null } }) });
    const out = view({ diagnosis: none });
    expect(out).toContain("There were no orders in either period");
    expect(out).not.toContain('aria-label="Change in each factor"');
    expect(out).not.toMatch(BAD);
  });

  it("lists what the explanation leaves out", () => {
    const out = view({ diagnosis: diagnosis({ notes: ["Visit counting is off, so devices and channels are left out."] }) });
    expect(out).toContain("Visit counting is off, so devices and channels are left out.");
  });
});
