import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { channelTable, type ChannelInput } from "@/lib/analytics-traffic";
import type { MarketingReport } from "@/server/analytics-traffic-data";

import {
  adUnit,
  channelColorIndex,
  channelColumns,
  contributionProfit,
  formatLtvToCac,
  formatPlain,
  headlineCards,
  MarketingView,
  marketingLtv,
  marketingNotes,
  merWords,
  OUTSIDE_SPEND_NOTE,
  type MarketingLtv,
  type MarketingViewProps,
} from "./marketing-view";
import { moneyWriter } from "./overview-view";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const text = (props: MarketingViewProps) =>
  renderToString(h(MarketingView, props))
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");

/** The words that must never reach a page: a figure that went wrong. */
const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;

const money = (minor: number) => moneyWriter("NOK", "nb-NO")(minor).replace(/[  ]/g, " ");

// ---------- fixtures ----------

const coverage = (over: Partial<MarketingReport["coverage"]> = {}): MarketingReport["coverage"] => ({
  counting: true,
  firstDay: "2026-09-03",
  partial: false,
  from: "2026-09-03",
  to: "2026-10-03",
  days: 30,
  ...over,
});

const input = (channel: string, over: Partial<ChannelInput> = {}): ChannelInput => ({
  channel,
  sessions: 1000,
  orders: 20,
  revenueMinor: 2_000_000,
  newCustomers: 15,
  spendMinor: 0,
  contributionBeforeMarketingMinor: 800_000,
  ...over,
});

/** A report the way `marketingReport()` gives it, with its table worked out by the library's own `channelTable()`. */
function report(inputs: ChannelInput[] | null, over: Partial<MarketingReport> = {}): MarketingReport {
  const table = inputs === null ? null : channelTable(inputs);
  const spent = inputs?.reduce((s, r) => s + r.spendMinor, 0) ?? 0;
  const byChannel = (inputs ?? []).filter((r) => r.spendMinor > 0).map((r) => ({ channel: r.channel, label: r.channel === "paid_search" ? "Paid search" : "Paid social", amountMinor: r.spendMinor }));
  return {
    currency: "NOK",
    counting: inputs !== null,
    coverage: coverage(inputs === null ? { counting: false, firstDay: null, partial: true, from: null, to: null, days: 0 } : {}),
    table,
    spend: { totalMinor: spent, byChannel, outsideCoverageMinor: inputs === null ? spent : 0 },
    unknownOrders: { orders: 0, revenueMinor: 0 },
    uncoveredOrders: { orders: 0, revenueMinor: 0 },
    unconverted: 0,
    missingCurrencies: [],
    notes: [],
    ...over,
  };
}

/** A store that is working: three channels with spend, an unknown row, costs known everywhere. */
const NORMAL_INPUTS: ChannelInput[] = [
  input("organic_search", { revenueMinor: 3_000_000, orders: 30, newCustomers: 20, sessions: 2000 }),
  input("paid_search", { revenueMinor: 1_500_000, orders: 12, newCustomers: 9, sessions: 800, spendMinor: 300_000, contributionBeforeMarketingMinor: 600_000 }),
  input("paid_social", { revenueMinor: 400_000, orders: 4, newCustomers: 4, sessions: 600, spendMinor: 200_000, contributionBeforeMarketingMinor: 120_000 }),
  input("unknown", { revenueMinor: 500_000, orders: 5, newCustomers: 3, sessions: null, contributionBeforeMarketingMinor: 200_000 }),
];

const LTV: MarketingLtv = { minor: 1_260_000, basis: "contribution", perOrderMinor: 300_000, ordersPerYear: 1.4, lifespanYears: 3 };

const props = (over: Partial<MarketingViewProps> = {}): MarketingViewProps => ({
  base: "/admin/shop",
  currency: "NOK",
  locale: "nb-NO",
  report: report(NORMAL_INPUTS, { unknownOrders: { orders: 5, revenueMinor: 500_000 } }),
  comparison: null,
  ltv: LTV,
  ...over,
});

const accessibleNames = (out: string) => {
  const svgs = [...out.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]);
  const images = svgs.filter((s) => /role="img"/.test(s));
  const lists = [...out.matchAll(/<ol\b[^>]*>/g)].map((m) => m[0]);
  const tables = [...out.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => m[0]);
  return { svgs, images, lists, tables };
};

// ---------- the pieces ----------

describe("helpers", () => {
  it("writes plain figures without a trailing zero or a minus zero", () => {
    expect(formatPlain(1.4)).toBe("1.4");
    expect(formatPlain(3)).toBe("3");
    expect(formatPlain(0.754)).toBe("0.75");
    expect(formatPlain(-0.001)).toBe("0");
    expect(formatPlain(null)).toBe("–");
    expect(formatPlain(Number.NaN)).toBe("–");
  });

  it("writes LTV:CAC as a ratio, and no figure when it cannot be known", () => {
    expect(formatLtvToCac(4.25)).toBe("4.3 : 1");
    expect(formatLtvToCac(null)).toBe("–");
    expect(formatLtvToCac(Number.POSITIVE_INFINITY)).toBe("–");
  });

  it("gives a channel its colour by its place in the list, and the muted one to what is not in it", () => {
    expect(channelColorIndex("direct")).toBe(0);
    expect(channelColorIndex("paid_search")).toBe(2);
    expect(channelColorIndex("unknown")).toBeGreaterThan(5);
  });

  it("takes the ad spend off a channel's contribution, and knows nothing when its costs are unknown", () => {
    expect(contributionProfit({ contributionBeforeMarketingMinor: 600_000, spendMinor: 300_000 })).toBe(300_000);
    expect(contributionProfit({ contributionBeforeMarketingMinor: 100_000, spendMinor: 300_000 })).toBe(-200_000);
    expect(contributionProfit({ contributionBeforeMarketingMinor: null, spendMinor: 300_000 })).toBeNull();
  });

  it("takes what the customers report says about lifetime value, with the amount it is made of", () => {
    const base = { historic: {} as never, inputs: { contributionPerOrderMinor: 300_000, revenuePerOrderMinor: 800_000, ordersPerYear: 1.4, lifespanYears: 3, contributionCustomers: 10, contributionOrders: 14 } };
    expect(marketingLtv({ ...base, predicted: { minor: 1, basis: "contribution", label: "" } })).toMatchObject({ basis: "contribution", perOrderMinor: 300_000 });
    expect(marketingLtv({ ...base, predicted: { minor: 1, basis: "revenue", label: "" } })).toMatchObject({ basis: "revenue", perOrderMinor: 800_000 });
    expect(marketingLtv({ ...base, predicted: { minor: null, basis: null, label: "" } })).toMatchObject({ minor: null, perOrderMinor: null });
  });
});

describe("headlineCards", () => {
  const find = (cards: ReturnType<typeof headlineCards>, start: string) => cards.find((c) => c.label.startsWith(start))!;

  it("works out blended CAC, ROAS, profit ROAS and LTV:CAC from the table", () => {
    const cards = headlineCards(props());
    // 500 000 spent on 36 new customers: 13 889 (minor) each.
    expect(find(cards, "Cost to win").value?.replace(/[  ]/g, " ")).toBe(money(Math.round(500_000 / 36)));
    // ROAS (blended): the two channels with ad spend, (1 500 000 + 400 000) / 500 000. Organic and unknown sales are not a return on ad spend.
    expect(find(cards, "Return on ad spend").value).toBe("3.8×");
    // MER: every sale, 5 400 000, over every ad krone, 500 000.
    expect(find(cards, "Sales per ad spend").value).toBe("10.8×");
    // Profit ROAS likewise on the spend channels: (600 000 + 120 000) / 500 000.
    expect(find(cards, "Profit return").value).toBe("1.4×");
    expect(find(cards, "Lifetime value").value).toBe("90.7 : 1");
    expect(find(cards, "Lifetime value").hint).toContain("× 1.4 orders a year × 3 years");
  });

  it("shows MER beside ROAS, labelled as every sale over every ad krone, and ROAS as the spend channels only", () => {
    const cards = headlineCards(props());
    const mer = find(cards, "Sales per ad spend");
    expect(mer.label).toBe("Sales per ad spend (MER)");
    expect(mer.hint).toContain("every sale divided by every ad krone");
    expect(mer.hint).toContain("direct and organic sales included");
    expect(mer.help).toContain("Marketing efficiency ratio");
    const roas = find(cards, "Return on ad spend");
    expect(roas.hint).toContain("from the channels that have ad spend");
    expect(roas.hint).toContain("Direct and organic sales are not counted");
    expect(cards.map((c) => c.label)).toHaveLength(5);
  });

  it("names the currency's unit in the MER words", () => {
    expect(merWords("NOK")).toBe("every sale divided by every ad krone");
    expect(merWords("SEK")).toBe("every sale divided by every ad krona");
    expect(merWords("EUR")).toBe("every sale divided by every ad euro");
    expect(adUnit("XYZ")).toBe("XYZ");
  });

  it("asks for the ad spend when none is entered, and never shows CAC or ROAS as zero", () => {
    const cards = headlineCards(props({ report: report(NORMAL_INPUTS.map((r) => ({ ...r, spendMinor: 0 }))) }));
    for (const key of ["Cost to win", "Return on ad spend", "Sales per ad spend", "Profit return", "Lifetime value"]) {
      const c = find(cards, key);
      expect(c.state).toBe("missing");
      expect(c.value).toBeNull();
    }
    expect(find(cards, "Cost to win").missing?.text).toMatch(/Enter what you spent on ads/);
    expect(find(cards, "Cost to win").missing?.action?.href).toBe("#spend");
  });

  it("says spend entered for other days is not in the figures", () => {
    const r = report(NORMAL_INPUTS.map((x) => ({ ...x, spendMinor: 0 })), { spend: { totalMinor: 90_000, byChannel: [], outsideCoverageMinor: 90_000 } });
    expect(find(headlineCards(props({ report: r })), "Cost to win").missing?.text).toContain("is for other days");
  });

  it("asks for visit counting when there is no table", () => {
    const cards = headlineCards(props({ report: report(null) }));
    for (const c of cards) {
      expect(c.state).toBe("missing");
      expect(c.missing?.text).toMatch(/Visit counting is off/);
    }
    expect(find(cards, "Cost to win").missing?.action?.href).toBe("/admin/shop/analytics/settings");
  });

  it("does not show a profit return when the costs are missing, and links to the products to add them", () => {
    const inputs = NORMAL_INPUTS.map((r) => ({ ...r, contributionBeforeMarketingMinor: null }));
    const c = find(headlineCards(props({ report: report(inputs) })), "Profit return");
    expect(c.state).toBe("missing");
    expect(c.missing?.text).toMatch(/costs are missing/);
    expect(c.missing?.action?.href).toBe("/admin/shop/products");
  });

  it("has no CAC when no new customer was won, and says so", () => {
    const inputs = NORMAL_INPUTS.map((r) => ({ ...r, newCustomers: 0 }));
    const cards = headlineCards(props({ report: report(inputs) }));
    expect(find(cards, "Cost to win").missing?.text).toMatch(/no new customer was won/);
    expect(find(cards, "Return on ad spend").value).toBe("3.8×");
    expect(find(cards, "Lifetime value").state).toBe("missing");
  });

  it("says LTV:CAC uses revenue when costs are not entered, and that it flatters", () => {
    const c = find(headlineCards(props({ ltv: { ...LTV, basis: "revenue" } })), "Lifetime value");
    expect(c.hint).toMatch(/uses revenue instead of profit, which flatters the ratio/);
  });

  it("says when lifetime value cannot be worked out yet", () => {
    expect(find(headlineCards(props({ ltv: { ...LTV, minor: null } })), "Lifetime value").missing?.text).toMatch(/cannot be worked out yet/);
    expect(find(headlineCards(props({ ltv: null })), "Lifetime value").state).toBe("missing");
  });

  it("compares against the previous period or last year, with no change for a figure the comparison lacks", () => {
    const earlier = report(NORMAL_INPUTS.map((r) => ({ ...r, spendMinor: r.spendMinor * 2 })));
    const prev = find(headlineCards(props({ comparison: { mode: "previous", report: earlier } })), "Return on ad spend");
    expect(prev.deltaPrevious?.text).toMatch(/^\+/);
    expect(prev.deltaLastYear).toBeUndefined();
    const year = find(headlineCards(props({ comparison: { mode: "year", report: earlier } })), "Return on ad spend");
    expect(year.deltaLastYear).toBeTruthy();
    expect(year.deltaPrevious).toBeUndefined();
    const none = find(headlineCards(props({ comparison: { mode: "previous", report: report(null) } })), "Return on ad spend");
    expect(none.deltaPrevious).toBeNull();
  });

  it("notes when the figures cover only the days with counted visits", () => {
    const r = report(NORMAL_INPUTS, { coverage: coverage({ partial: true, days: 12 }) });
    expect(find(headlineCards(props({ report: r })), "Cost to win").hint).toContain("Over the 12 days with counted visits.");
  });
});

describe("channelColumns", () => {
  it("has the columns the page promises", () => {
    expect(channelColumns(money).map((c) => c.label)).toEqual([
      "Channel", "Sessions", "Orders", "Revenue", "Conversion", "Avg order", "New customers", "Ad spend", "CAC", "ROAS", "Profit ROAS", "Contribution profit",
    ]);
  });
});

describe("marketingNotes", () => {
  it("words spend outside the covered days with its amount, and drops the report's generic line", () => {
    const r = report(NORMAL_INPUTS, { notes: [OUTSIDE_SPEND_NOTE, "Visits have been counted since 2026-09-03, so these figures cover only the days from then."], spend: { totalMinor: 590_000, byChannel: [], outsideCoverageMinor: 90_000 } });
    const notes = marketingNotes(r, money);
    expect(notes.map((n) => n.text)).not.toContain(OUTSIDE_SPEND_NOTE);
    expect(notes.some((n) => n.tone === "warning" && n.text.includes(money(90_000)) && /not in the CAC and ROAS/.test(n.text))).toBe(true);
    expect(notes.some((n) => /counted since 2026-09-03/.test(n.text))).toBe(true);
  });

  it("says spend cannot be matched when no visits are counted", () => {
    const r = report(null, { spend: { totalMinor: 90_000, byChannel: [], outsideCoverageMinor: 90_000 } });
    expect(marketingNotes(r, money)[0].text).toMatch(/cannot be matched to sales/);
  });

  it("has no notes when there is nothing to say", () => {
    expect(marketingNotes(report(NORMAL_INPUTS), money)).toEqual([]);
  });
});

// ---------- the view ----------

describe("MarketingView", () => {
  it("shows a normal store: the headline strip, the channel table with its totals, and the caption about ROAS", () => {
    const out = text(props());
    expect(out).toContain("What a customer costs");
    expect(out).toContain("Cost to win a customer (CAC)");
    expect(out).toContain("10.8×");
    expect(out).toContain("90.7 : 1");
    expect(out).toContain("Paid search");
    expect(out).toContain("Organic search");
    expect(out).toContain("All channels");
    expect(out).toContain("ROAS can flatter a channel");
    expect(out).toContain("Profit ROAS counts what the goods cost");
    expect(out).toContain("Sales per ad spend (MER)");
    expect(out).toContain("The All channels row counts only the channels that have ad spend");
    expect(out).not.toMatch(BAD);
  });

  it("explains the Unknown row with its orders and revenue", () => {
    const out = text(props());
    expect(out).toContain("What “Unknown” is");
    expect(out).toContain("Paid orders that cannot be tied to a counted visit");
    expect(out).toContain(`5 orders, ${money(500_000)}`);
  });

  it("explains the jargon in plain words", () => {
    const out = text(props());
    expect(out).toContain("Customer acquisition cost");
    expect(out).toContain("Return on ad spend");
    expect(out).toContain("What the columns mean");
    expect(out).toMatch(/Profit ROAS<\/dt>|Profit ROAS: /);
  });

  it("shows the empty store calmly: no orders, no spend, visit counting off", () => {
    const out = text(props({ report: report(null), ltv: null }));
    expect(out).toContain("Enter your ad spend to see CAC and ROAS");
    expect(out).toContain("Visit counting is off");
    expect(out).toContain("No channel figures for this period");
    expect(out).not.toMatch(BAD);
    // Nothing is drawn as a zero figure.
    expect(out).not.toMatch(/0,00 kr|0\.0×|0 : 1/);
  });

  it("shows a store with counted visits but no orders and no spend with an empty table and the ad-spend prompt", () => {
    const empty = report([]);
    const out = text(props({ report: empty, ltv: null }));
    expect(out).toContain("Enter your ad spend to see CAC and ROAS");
    expect(out).toContain("No visits, orders or ad spend on the days with counted visits.");
    expect(out).not.toMatch(BAD);
  });

  it("never shows a zero profit when costs are missing: the profit cells have no figure and say why", () => {
    const inputs = NORMAL_INPUTS.map((r) => ({ ...r, contributionBeforeMarketingMinor: null }));
    const out = text(props({ report: report(inputs) }));
    expect(out).toContain("Product costs are missing for some of the sales");
    expect(out).toContain("Add product costs");
    expect(out).toContain('title="Product costs are not known for these sales"');
    expect(out).not.toMatch(BAD);
  });

  it("notes partial visit coverage and spend outside it", () => {
    const r = report(NORMAL_INPUTS, {
      coverage: coverage({ partial: true, days: 12, firstDay: "2026-09-21" }),
      notes: ["Visits have been counted since 2026-09-21, so these figures cover only the days from then.", OUTSIDE_SPEND_NOTE],
      spend: { totalMinor: 590_000, byChannel: [{ channel: "paid_search", label: "Paid search", amountMinor: 590_000 }], outsideCoverageMinor: 90_000 },
    });
    const out = text(props({ report: r }));
    expect(out).toContain("Visits have been counted since 2026-09-21");
    expect(out).toContain(`${money(90_000)} of the ad spend you entered is for days without counted visits`);
    expect(out).toContain("Over the 12 days with counted visits.");
    expect(out.split("left out of CAC and ROAS").length).toBe(1);
  });

  it("carries the currency note from the report", () => {
    const r = report(NORMAL_INPUTS, { notes: ["2 paid orders in SEK could not be converted, so they are left out."] });
    expect(text(props({ report: r }))).toContain("2 paid orders in SEK could not be converted");
  });

  it("names every chart and table, and never prints a missing figure as one", () => {
    const out = text(props());
    const { svgs, images, lists, tables } = accessibleNames(out);
    expect(images.length).toBe(svgs.length);
    for (const svg of images) expect(svg).toMatch(/aria-label="[^"]+"/);
    expect(lists.length).toBe(2);
    for (const ol of lists) expect(ol).toMatch(/aria-label="[^"]+"/);
    expect(out).toContain('aria-label="Revenue by channel"');
    expect(out).toContain('aria-label="Ad spend by channel"');
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(t).toMatch(/<caption[^>]*>[^<]+<\/caption>/);
    expect(out).not.toMatch(BAD);
  });

  it("writes the table's money with the store's currency, and no spend as no figure rather than zero", () => {
    const out = text(props());
    expect(out).toContain(money(3_000_000));
    // The organic channel has no spend: its spend, CAC and ROAS cells are dashes with a reason.
    expect(out).toContain('title="No ad spend entered for this channel"');
  });

  it("works with no comparison and with a comparison that has no table", () => {
    expect(text(props({ comparison: { mode: "previous", report: report(null) } }))).not.toMatch(BAD);
  });
});
