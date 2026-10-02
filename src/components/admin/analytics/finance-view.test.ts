import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { financeStatement, type FinanceLine } from "@/lib/analytics-finance";
import { DEFAULT_ANALYTICS_SETTINGS, EMPTY_TOTALS, type AnalyticsSettings, type Totals } from "@/lib/analytics-kpi";
import type { SeriesPoint } from "@/server/analytics-totals";

import {
  currencyNotes,
  FINANCE_DEFINITIONS,
  FinanceView,
  hasNoSales,
  lineChange,
  missingCostCount,
  moneyWriter,
  profitLines,
  type FinancePeriodData,
  type FinanceSetup,
  type FinanceViewProps,
} from "./finance-view";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ");

const BASE = "/admin/shop";
const plain = (text: string) => text.replace(/[  ]/g, " ");
const writer = moneyWriter("NOK", "nb-NO");
const money = (minor: number) => plain(writer(minor));

/** The words that must never reach a page: a figure that went wrong. */
const BROKEN = /\bNaN\b|Infinity|undefined|\bnull\b|\[object/;

// ---------- fixtures ----------

const SETTINGS: AnalyticsSettings = { ...DEFAULT_ANALYTICS_SETTINGS, paymentFeeBps: 140, paymentFeeFixedMinor: 180, shippingCostMinor: 5000, fixedCostsMonthlyMinor: 300_000 };
const DAYS = 30;

const totals = (over: Partial<Totals> = {}): Totals => ({ ...EMPTY_TOTALS, ...over });

const NORMAL = totals({
  orders: 40,
  grossSalesMinor: 1_400_000,
  discountsMinor: 200_000,
  shippingMinor: 50_000,
  vatMinor: 300_000,
  revenueMinor: 1_250_000,
  refundsMinor: 50_000,
  cogsMinor: 400_000,
  knownCostRevenueMinor: 1_250_000,
  paymentFeesMinor: 20_000,
  platformFeesMinor: 10_000,
  shippingCostsMinor: 8_000,
  marketingMinor: 100_000,
});
const EARLIER = totals({ ...NORMAL, orders: 30, grossSalesMinor: 1_100_000, revenueMinor: 950_000, refundsMinor: 20_000, cogsMinor: 350_000, knownCostRevenueMinor: 950_000, vatMinor: 230_000, marketingMinor: 120_000 });

function period(t: Totals, over: Partial<FinancePeriodData> = {}, settings: AnalyticsSettings = SETTINGS): FinancePeriodData {
  return { label: "16 Sep – 15 Oct 2026", totals: t, statement: financeStatement(t, settings, DAYS), unconverted: 0, missingCurrencies: [], ...over };
}

const point = (i: number, over: Partial<SeriesPoint> = {}): SeriesPoint => ({
  key: `2026-10-${String(10 + i).padStart(2, "0")}`,
  label: `${10 + i} Oct`,
  from: `2026-10-${String(10 + i).padStart(2, "0")}`,
  to: `2026-10-${String(11 + i).padStart(2, "0")}`,
  orders: 8,
  revenueMinor: 250_000,
  refundsMinor: 10_000,
  netRevenueMinor: 240_000,
  cogsMinor: 80_000,
  grossProfitMinor: 160_000,
  contributionMinor: 130_000 + i * 1000,
  newCustomers: 5,
  returningCustomers: 2,
  ...over,
});
const SERIES = Array.from({ length: 5 }, (_, i) => point(i));
const FLAT = Array.from({ length: 5 }, (_, i) => point(i, { orders: 0, revenueMinor: 0, refundsMinor: 0, netRevenueMinor: 0, cogsMinor: 0, grossProfitMinor: null, contributionMinor: null }));

const SETUP: FinanceSetup = { activeVariants: 40, variantsWithCost: 28, backfillableLines: 0 };

function view(over: Partial<FinanceViewProps> = {}): string {
  const props: FinanceViewProps = {
    base: BASE,
    currency: "NOK",
    locale: "nb-NO",
    isOwner: true,
    current: period(NORMAL),
    comparison: { mode: "previous", data: period(EARLIER, { label: "17 Aug – 15 Sep 2026" }) },
    bucket: "day",
    series: SERIES,
    comparisonSeries: SERIES.map((p) => ({ ...p, netRevenueMinor: 200_000 })),
    setup: SETUP,
    ...over,
  };
  return html(h(FinanceView, props));
}

/** The visible words: tags and attributes gone. */
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/** Every chart is a named image or a labelled list: nothing is drawn without a name. */
function expectNamedCharts(markup: string) {
  for (const tag of markup.match(/<svg\b[^>]*>/g) ?? []) expect(tag).toMatch(/aria-label="[^"]+"/);
  for (const tag of markup.match(/<ol\b[^>]*>/g) ?? []) expect(tag).toMatch(/aria-label="[^"]+"/);
}

// ---------- the pure helpers ----------

describe("lineChange", () => {
  const line = (key: FinanceLine["key"], amountMinor: number | null): FinanceLine => ({ key, label: key, amountMinor, subtotal: false, estimated: false, missing: false, shareOfNet: null, note: null });

  it("reads a rise in income as good news", () => {
    expect(lineChange(line("revenue", 120), line("revenue", 100))).toMatchObject({ text: "+20.0 %", verdict: "good" });
  });

  it("reads a deduction on its size: costs going from -100 to -150 are +50 % and bad news", () => {
    expect(lineChange(line("cogs", -150), line("cogs", -100))).toMatchObject({ text: "+50.0 %", verdict: "bad" });
    expect(lineChange(line("refunds", -50), line("refunds", -100))).toMatchObject({ text: "−50.0 %", verdict: "good" });
  });

  it("has no change when either side cannot be known", () => {
    expect(lineChange(line("cogs", null), line("cogs", -100))).toBeNull();
    expect(lineChange(line("cogs", -100), line("cogs", null))).toBeNull();
    expect(lineChange(line("cogs", -100), undefined)).toBeNull();
  });

  it("treats a rounding line the comparison lacks as 0", () => {
    expect(lineChange(line("rounding", 2), undefined)).toMatchObject({ verdict: "neutral" });
  });

  it("calls a change under a twentieth of a percent noise", () => {
    expect(lineChange(line("revenue", 1_000_001), line("revenue", 1_000_000))?.verdict).toBe("neutral");
  });
});

describe("profitLines", () => {
  it("opens with a calm sentence for an empty period", () => {
    const lines = profitLines(period(EMPTY_TOTALS), money);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("No orders were paid in this period yet");
  });

  it("says what is left after each step, and that the last is an estimate", () => {
    const lines = profitLines(period(NORMAL), money).join(" ");
    expect(lines).toContain("40 paid orders brought in");
    expect(lines).toContain("gross profit of");
    expect(lines).toContain("contribution profit is about");
    expect(lines).toContain("That is an estimate");
  });

  it("never states a profit when no cost is known", () => {
    const lines = profitLines(period(totals({ ...NORMAL, knownCostRevenueMinor: 0, cogsMinor: 0 })), money).join(" ");
    expect(lines).toContain("no profit to show");
    expect(lines).not.toContain("gross profit of");
  });

  it("says a shortfall is a shortfall", () => {
    const lines = profitLines(period(totals({ ...NORMAL, cogsMinor: 1_400_000 })), money).join(" ");
    expect(lines).toContain("more than they brought in");
    expect(lines).toContain("short");
  });

  it("does not claim sales for a period with refunds only", () => {
    const lines = profitLines(period(totals({ refundsMinor: 20_000 })), money);
    expect(lines[0]).toContain("No orders were paid");
    expect(lines[0]).toContain("refunds of");
  });
});

describe("currencyNotes and missingCostCount", () => {
  it("is silent when nothing was left out", () => {
    expect(currencyNotes(period(NORMAL), null, "NOK")).toEqual([]);
  });

  it("names the currencies left out, for the period and for the comparison", () => {
    const notes = currencyNotes(period(NORMAL, { unconverted: 3, missingCurrencies: ["SEK", "DKK"] }), period(EARLIER, { unconverted: 1, missingCurrencies: ["SEK"] }), "NOK");
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("3 orders and refunds in SEK, DKK are left out of these figures");
    expect(notes[1]).toContain("1 order or refund in SEK is left out of the comparison period");
  });

  it("counts product options without a cost, and says nothing when that is not known", () => {
    expect(missingCostCount(SETUP)).toBe(12);
    expect(missingCostCount({ activeVariants: 3, variantsWithCost: 5, backfillableLines: 0 })).toBe(0);
    expect(missingCostCount(null)).toBeNull();
  });

  it("knows an empty period", () => {
    expect(hasNoSales(period(EMPTY_TOTALS))).toBe(true);
    expect(hasNoSales(period(NORMAL))).toBe(false);
    expect(hasNoSales(period(totals({ refundsMinor: 1 })))).toBe(false);
  });
});

// ---------- the view ----------

describe("FinanceView, a normal store", () => {
  const markup = view();
  const words = text(markup);

  it("draws no broken figure anywhere", () => {
    expect(markup).not.toMatch(BROKEN);
  });

  it("opens with what is left, in plain sentences, and the four main cards", () => {
    expect(words).toContain("How much of what we sell is left?");
    expect(words).toContain("40 paid orders brought in");
    for (const label of ["Net revenue", "Gross margin", "Contribution margin", "Operating profit (estimate)"]) expect(words).toContain(label);
  });

  it("draws the whole bridge in order, each line with its amount", () => {
    const keys = [...markup.matchAll(/data-line="(\w+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(["grossSales", "discounts", "shippingIncome", "revenue", "refunds", "netRevenue", "cogs", "grossProfit", "paymentFees", "platformFees", "shippingCosts", "marketing", "contributionProfit", "fixedCosts", "operatingProfit"]);
    expect(words).toContain(money(1_400_000));
    expect(words).toContain(money(-200_000));
    expect(words).toContain(money(800_000));
  });

  it("has the four columns of the bridge, with the comparison's own name and dates", () => {
    expect(words).toContain("This period");
    expect(words).toContain("Previous period");
    expect(words).toContain("17 Aug – 15 Sep 2026");
    expect(words).toContain("Change");
    expect(words).toContain("Share of net revenue");
  });

  it("gives the share of net revenue, 100 % for net revenue itself", () => {
    const row = markup.match(/<tr[^>]*data-line="netRevenue"[\s\S]*?<\/tr>/)![0];
    expect(text(row)).toContain("100.0 %");
    const gross = markup.match(/<tr[^>]*data-line="grossProfit"[\s\S]*?<\/tr>/)![0];
    expect(text(gross)).toContain("66.7 %");
  });

  it("tags the estimated lines, and says where an estimate comes from", () => {
    expect(markup.match(/Estimated/g)!.length).toBeGreaterThanOrEqual(4);
    expect(words).toContain("Estimated from the fee in Analytics settings");
    expect(words).toContain("Estimated from the cost per order in Analytics settings");
    expect(words).not.toContain("Costs missing");
  });

  it("words a change with an arrow, a sign and a hidden word, never colour alone", () => {
    const row = markup.match(/<tr[^>]*data-line="revenue"[\s\S]*?<\/tr>/)![0];
    expect(row).toContain("▲");
    expect(row).toContain("Up, better: ");
    expect(row).toContain("+31.6 %");
  });

  it("reads a cost that grew as worse", () => {
    const row = markup.match(/<tr[^>]*data-line="cogs"[\s\S]*?<\/tr>/)![0];
    expect(row).toContain("Up, worse: ");
  });

  it("names every chart", () => {
    expectNamedCharts(markup);
    expect(markup).toContain('aria-label="Where net revenue went, from net revenue to operating profit"');
    expect(markup).toContain('aria-label="Net revenue and contribution profit per day"');
  });

  it("shows where net revenue went, with minus amounts and shares", () => {
    const list = markup.match(/<ol aria-label="Where net revenue went[\s\S]*?<\/ol>/)![0];
    expect(text(list)).toContain("Cost of goods");
    expect(text(list)).toContain(money(-400_000));
    expect(text(list)).toContain("Operating profit");
  });

  it("explains VAT as not income, and notes refunds seen only here", () => {
    expect(words).toContain("VAT collected");
    expect(words).toContain(money(300_000));
    expect(words).toContain("Not income");
    expect(words).toContain("Refunds made only in the payment provider's dashboard are not seen");
  });

  it("closes with every definition in a disclosure", () => {
    expect(markup).toContain("<details");
    for (const d of FINANCE_DEFINITIONS) expect(words).toContain(d.term);
    expect(words).toContain("How these are worked out");
  });

  it("raises no cost warning when every sale has a cost and fees are entered", () => {
    expect(words).not.toContain("is based on");
    expect(words).not.toContain("Profit cannot be shown yet");
    expect(words).not.toContain("not entered, so");
  });
});

describe("FinanceView, an empty store", () => {
  const markup = view({ current: period(EMPTY_TOTALS), comparison: { mode: "previous", data: period(EMPTY_TOTALS) }, series: FLAT, comparisonSeries: FLAT.map((p) => ({ ...p })) });
  const words = text(markup);

  it("is calm: a sentence, no table, no cards, no chart", () => {
    expect(words).toContain("No orders were paid in this period yet");
    expect(markup).not.toContain("data-line=");
    expect(markup).not.toContain("<svg");
    expect(markup).not.toContain('data-state="ok"');
    expect(markup).not.toContain("Profit cannot be shown yet");
  });

  it("draws no broken figure and keeps the definitions", () => {
    expect(markup).not.toMatch(BROKEN);
    expect(words).toContain("How these are worked out");
    expectNamedCharts(markup);
  });

  it("still explains orders left out when that is why it is empty", () => {
    const left = view({ current: period(EMPTY_TOTALS, { unconverted: 4, missingCurrencies: ["SEK"] }), comparison: null, series: FLAT, comparisonSeries: null });
    expect(text(left)).toContain("4 orders and refunds in SEK are left out of these figures");
  });
});

describe("FinanceView, product costs missing", () => {
  const noCosts = totals({ ...NORMAL, knownCostRevenueMinor: 0, cogsMinor: 0 });
  const markup = view({ current: period(noCosts), comparison: { mode: "previous", data: period(noCosts) }, series: SERIES.map((p) => ({ ...p, grossProfitMinor: null, contributionMinor: null })) });
  const words = text(markup);

  it("asks for costs and shows no profit, not a zero", () => {
    expect(words).toContain("Profit cannot be shown yet");
    expect(words).toContain("Add costs to 12 product options");
    expect(words).toContain("Needs product costs");
    expect(markup).not.toMatch(BROKEN);
    for (const key of ["cogs", "grossProfit", "contributionProfit", "operatingProfit"]) {
      const row = markup.match(new RegExp(`<tr[^>]*data-line="${key}"[\\s\\S]*?</tr>`))![0];
      expect(row).toContain("Costs missing");
      expect(text(row)).toContain("–");
      expect(text(row)).not.toContain(money(0));
    }
  });

  it("links to where the costs are added", () => {
    expect(markup).toContain(`href="${BASE}/products"`);
  });

  it("draws the three profit cards as missing, with the dash and a hidden word", () => {
    expect(markup.match(/data-state="missing"/g)!.length).toBe(3);
    expect(markup).toContain("Not available");
  });

  it("draws only net revenue in the chart and says why", () => {
    expect(words).toContain("Contribution profit needs product costs, so only net revenue is drawn.");
    expectNamedCharts(markup);
  });

  it("does not claim a profit on the bars", () => {
    const list = markup.match(/<ol aria-label="Where net revenue went[\s\S]*?<\/ol>/)![0];
    const cogs = list.match(/<li[^>]*>[\s\S]*?Cost of goods[\s\S]*?<\/li>/)![0];
    expect(text(cogs)).toContain("–");
    expect(text(cogs)).toContain("costs missing");
  });

  it("tells a member who is not an owner nothing they cannot do", () => {
    const staff = view({ current: period(noCosts), comparison: null, isOwner: false, setup: { ...SETUP, backfillableLines: 5 } });
    expect(staff).not.toContain(`${BASE}/analytics/settings`);
  });
});

describe("FinanceView, costs known for part of the sales", () => {
  const partial = totals({ ...NORMAL, knownCostRevenueMinor: 1_037_500 }); // 83 % of 1 250 000
  const markup = view({ current: period(partial), setup: { ...SETUP, backfillableLines: 7 } });
  const words = text(markup);

  it("says how much of sales the profit rests on, and how many products to add costs to", () => {
    expect(words).toContain("Profit is estimated from the 83 % of sales whose cost is known");
    expect(words).toContain("Add costs to 12 product options");
    expect(words).toContain("based on 83 % of sales");
  });

  it("still shows the profit, with the warning", () => {
    expect(words).not.toContain("Profit cannot be shown yet");
    expect(markup).toContain('data-line="grossProfit"');
    expect(markup).not.toMatch(BROKEN);
  });

  it("offers to apply costs entered since to earlier orders, to owners", () => {
    expect(words).toContain("7 earlier order lines can be filled in with costs entered since");
    expect(markup).toContain(`href="${BASE}/analytics/settings"`);
  });

  it("is a warning below 80 % and a plain note above it", () => {
    expect(markup).toContain('data-tone="info"');
    const low = view({ current: period(totals({ ...NORMAL, knownCostRevenueMinor: 500_000 })) });
    expect(low).toContain('data-tone="warning"');
    expect(text(low)).toContain("Profit is estimated from the 40 % of sales whose cost is known");
  });

  it("marks the cost of goods and the profits as estimated, and writes the estimate in the opening sentence", () => {
    expect(markup).toMatch(/data-line="cogs"[\s\S]*?estimated/);
    expect(words).toContain("The goods cost an estimated");
    expect(words).toContain("estimated from the 83 % of sales whose cost is known");
  });

  it("falls back to a general sentence when the count is not known", () => {
    const unknown = text(view({ current: period(partial), setup: null }));
    expect(unknown).toContain("Add what each product costs in the product editor.");
    expect(unknown).not.toContain("Add costs to");
  });
});

describe("FinanceView, too few costs known to estimate from", () => {
  const few = totals({ ...NORMAL, knownCostRevenueMinor: 250_000 }); // 20 % of 1 250 000
  const markup = view({ current: period(few) });
  const words = text(markup);

  it("shows no profit, says how few costs are known and why that is too few", () => {
    expect(words).toContain("Profit cannot be shown yet");
    expect(words).toContain("Product costs are known for only 20 % of sales, too few to estimate from (30 % is the least)");
    expect(words).not.toContain("None of the products sold has a cost entered");
  });

  it("still shows the gross margin of the sales whose cost is known", () => {
    expect(words).toContain("Gross margin");
    expect(words).toContain("On the sales whose cost is known, the gross margin is");
  });
});

describe("FinanceView, settings not entered", () => {
  it("tags the estimates that count as nothing and says profit may look better than it is", () => {
    const bare = { ...DEFAULT_ANALYTICS_SETTINGS };
    const markup = view({ current: period(NORMAL, {}, bare), comparison: null });
    const words = text(markup);
    expect(markup.match(/Costs missing/g)!.length).toBe(3);
    expect(words).toContain("payment fees, shipping costs and fixed costs are not entered");
    expect(words).toContain("No payment fee is set in Analytics settings, so it counts as 0.");
    expect(markup).not.toMatch(BROKEN);
  });
});

describe("FinanceView, currencies and comparisons", () => {
  it("says what the currencies it could not convert did to the figures", () => {
    const markup = view({ current: period(NORMAL, { unconverted: 2, missingCurrencies: ["SEK"] }) });
    expect(text(markup)).toContain("2 orders and refunds in SEK are left out of these figures because the store has no rate to NOK");
  });

  it("leaves the comparison columns out when no comparison is chosen", () => {
    const markup = view({ comparison: null, comparisonSeries: null });
    const words = text(markup);
    expect(words).not.toContain("Previous period");
    expect(markup).not.toContain(">Change<");
    expect(words).toContain("Share of net revenue");
    expectNamedCharts(markup);
  });

  it("names the same period last year when that is the comparison", () => {
    const markup = view({ comparison: { mode: "year", data: period(EARLIER, { label: "16 Sep – 15 Oct 2025" }) } });
    expect(text(markup)).toContain("Same period last year");
    expect(text(markup)).toContain("16 Sep – 15 Oct 2025");
  });

  it("does not compare with a period that had no orders", () => {
    const markup = view({ comparison: { mode: "previous", data: period(EMPTY_TOTALS, { label: "17 Aug – 15 Sep 2026" }) } });
    const words = text(markup);
    expect(words).toContain("No orders were paid in the previous period, so there is nothing to compare with.");
    expect(markup).not.toMatch(BROKEN);
    const row = markup.match(/<tr[^>]*data-line="revenue"[\s\S]*?<\/tr>/)![0];
    expect(row).not.toContain("▲");
    expect(row).not.toContain("new");
  });

  it("works for a store with one bucket, one sale and a refund larger than it", () => {
    const odd = totals({ orders: 1, grossSalesMinor: 10_000, revenueMinor: 10_000, refundsMinor: 12_000, vatMinor: 2_000, knownCostRevenueMinor: 10_000, cogsMinor: 4_000 });
    const markup = view({ current: period(odd), comparison: null, comparisonSeries: null, series: [point(0)] });
    expect(markup).not.toMatch(BROKEN);
    expectNamedCharts(markup);
    expect(text(markup)).toContain("Share of net revenue");
  });
});
