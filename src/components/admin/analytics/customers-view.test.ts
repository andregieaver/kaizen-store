import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildCohorts,
  cohortTrend,
  ltvHistoric,
  ltvPredicted,
  newVsReturning,
  purchaseFrequency,
  repeatRates,
  rfm,
  RFM_MIN_CUSTOMERS,
  RFM_SEGMENTS,
  segmentSummary,
  type CustomerAggregate,
  type OrderMonth,
  type PeriodCustomer,
} from "@/lib/analytics-customers";
import { NO_FIGURE } from "@/lib/analytics-core";
import type { CustomersReport, TopCustomer } from "@/server/analytics-customers-data";

import { cohortColumn, countOf, CustomersView, decimalOf, lastOrderText, monthText, moneyOf, SEGMENT_COPY, SMALL_BASE, type CustomersViewProps } from "./customers-view";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ");
/** The words only. */
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

const NOW = new Date("2026-10-15T10:00:00Z");
const BASE = "/admin/shop";
const money = moneyOf("NOK", "nb-NO");
const plain = (text: string) => text.replace(/[  ]/g, " ");

// ---------- fixtures ----------

const monthAdd = (month: string, k: number): string => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + k;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

type Costs = "all" | "partial" | "none";

/** Customer `i` of a store with thirteen months of history: ordering one to three times, in the months after their first. */
function customer(i: number, costs: Costs): CustomerAggregate & { secondOrderAt: string | null; orderMonths: readonly OrderMonth[] } {
  const first = monthAdd("2025-10", i % 13);
  const wanted = i % 5 === 0 ? 3 : i % 3 === 0 ? 2 : 1;
  const months: string[] = [];
  for (let k = 0; k < wanted; k += 1) {
    const m = monthAdd(first, k);
    if (m > "2026-10") break;
    months.push(m);
  }
  const perOrder = 20_000 + (i % 7) * 1000;
  const orderMonths = months.map((month) => ({ month, orders: 1, revenueMinor: perOrder }));
  const revenueMinor = perOrder * months.length;
  const known = costs === "all" || (costs === "partial" && i % 5 < 3);
  const last = months[months.length - 1];
  return {
    key: `person${i}@example.com`,
    firstOrderAt: `${first}-03T10:00:00Z`,
    lastOrderAt: `${last}-10T10:00:00Z`,
    orders: months.length,
    revenueMinor,
    contributionMinor: known ? Math.round(revenueMinor * 0.45) : null,
    secondOrderAt: months.length > 1 ? `${months[1]}-10T10:00:00Z` : null,
    orderMonths,
  };
}

const TOP: TopCustomer[] = [
  { key: "anna@example.com", email: "anna@example.com", name: "Anna Berg", customerId: "11111111-1111-4111-8111-111111111111", account: true, orders: 3, revenueMinor: 90_000, lifetimeOrders: 7, lastOrderAt: "2026-10-12T09:00:00Z" },
  { key: "guest@example.com", email: "guest@example.com", name: null, customerId: "22222222-2222-4222-8222-222222222222", account: false, orders: 1, revenueMinor: 45_000, lifetimeOrders: 1, lastOrderAt: "2026-10-01T09:00:00Z" },
];

type Options = { n?: number; costs?: Costs; periodCustomers?: boolean; top?: TopCustomer[]; over?: Partial<CustomersReport> };

/** A report made the way the server makes it: the same pure functions over the same kind of rows. */
function report({ n = 260, costs = "all", periodCustomers = true, top = TOP, over = {} }: Options = {}): CustomersReport {
  const aggregates = Array.from({ length: n }, (_, i) => customer(i, costs));
  const period: PeriodCustomer[] = periodCustomers
    ? aggregates
        .filter((a) => a.lastOrderAt >= "2026-09-15")
        .map((a) => ({ key: a.key, firstOrderAt: a.firstOrderAt, ordersInPeriod: 1, revenueMinor: Math.round(a.revenueMinor / a.orders) }))
    : [];
  const orders = aggregates.reduce((a, c) => a + c.orders, 0);
  const known = aggregates.filter((a) => a.contributionMinor !== null);
  const knownOrders = known.reduce((a, c) => a + c.orders, 0);
  const perCustomer = purchaseFrequency(orders, n);
  const contributionPerOrderMinor = knownOrders > 0 ? Math.round(known.reduce((a, c) => a + (c.contributionMinor as number), 0) / knownOrders) : null;
  const revenuePerOrderMinor = orders > 0 ? Math.round(aggregates.reduce((a, c) => a + c.revenueMinor, 0) / orders) : null;
  const cohorts = buildCohorts(aggregates, "2026-10-15", 13, 12);
  const scored = rfm(aggregates, NOW);
  return {
    currency: "NOK",
    period: { from: "2026-09-15", to: "2026-10-15", days: 30 },
    today: "2026-10-15",
    now: NOW.toISOString(),
    customers: n,
    newVsReturning: newVsReturning(period, "2026-09-15T00:00:00Z", "2026-10-15T00:00:00Z"),
    repeatRates: repeatRates(aggregates, NOW),
    frequency: { orders365: orders, customers365: n, perCustomer },
    ltv: {
      historic: ltvHistoric(aggregates),
      predicted: ltvPredicted({ contributionPerOrderMinor, revenuePerOrderMinor, ordersPerYear: perCustomer, lifespanYears: 3 }),
      inputs: { contributionPerOrderMinor, revenuePerOrderMinor, ordersPerYear: perCustomer, lifespanYears: 3, contributionCustomers: known.length, contributionOrders: knownOrders },
    },
    cohorts,
    cohortTrend: cohortTrend(cohorts),
    segments: { enough: scored.length >= RFM_MIN_CUSTOMERS, minCustomers: RFM_MIN_CUSTOMERS, customers: scored.length, summary: segmentSummary(scored) },
    topCustomers: n === 0 ? [] : top,
    truncated: false,
    cap: 200_000,
    unconverted: 0,
    missingRates: [],
    ...over,
  };
}

function view(r: CustomersReport, over: Partial<CustomersViewProps> = {}): string {
  return html(h(CustomersView, { base: BASE, locale: "nb-NO", timeZone: "Europe/Oslo", isOwner: true, report: r, ...over }));
}

/** Nothing that looks like a broken number or a leaked value. */
function expectClean(markup: string) {
  const text = words(markup);
  expect(text).not.toMatch(/NaN/);
  expect(text).not.toMatch(/Infinity/);
  expect(text).not.toMatch(/undefined/);
  expect(text).not.toMatch(/\bnull\b/);
  expect(text).not.toMatch(/\[object/);
  expect(markup).not.toMatch(/="(NaN|undefined|null)"/);
}

/** Whether the card with this label is drawn as a figure or as missing: the state attribute nearest before the label. */
function cardState(markup: string, label: string): "ok" | "missing" | null {
  const found = new RegExp(`data-state="(ok|missing)"(?:(?!data-state=)[\\s\\S])*?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(markup);
  return found ? (found[1] as "ok" | "missing") : null;
}

/** Every chart (a table or an image) is named: a caption for each table, a label for each image. */
function expectNamedCharts(markup: string) {
  const tables = markup.match(/<table/g)?.length ?? 0;
  const captions = markup.match(/<caption/g)?.length ?? 0;
  expect(captions).toBe(tables);
  for (const img of markup.match(/<[a-z]+[^>]*role="img"[^>]*>/g) ?? []) expect(img).toMatch(/aria-label="[^"]+"/);
  for (const caption of markup.match(/<caption[^>]*>[^<]*<\/caption>/g) ?? []) expect(caption.replace(/<[^>]*>/g, "").trim().length).toBeGreaterThan(0);
}

// ---------- helpers ----------

describe("the writers", () => {
  it("never writes a missing figure as a number", () => {
    expect(money(null)).toBe(NO_FIGURE);
    expect(money(undefined)).toBe(NO_FIGURE);
    expect(money(Number.NaN)).toBe(NO_FIGURE);
    expect(money(Number.POSITIVE_INFINITY)).toBe(NO_FIGURE);
    expect(decimalOf()(null)).toBe(NO_FIGURE);
    expect(decimalOf()(Number.NaN)).toBe(NO_FIGURE);
  });

  it("writes amounts, decimals, counts, months and days", () => {
    expect(plain(money(123_456))).toContain("1 234,56");
    // Only an amount follows the market's locale; every other figure is written the same way in all markets (analytics-format.ts).
    expect(decimalOf()(1.44)).toBe("1.4");
    expect(countOf(1, "order")).toBe("1 order");
    expect(plain(countOf(1200, "customer"))).toBe("1 200 customers");
    expect(monthText("2026-03")).toBe("Mar 2026");
    expect(monthText("soon")).toBe("soon");
    expect(cohortColumn(0)).toBe("Same month");
    expect(cohortColumn(6)).toBe("Month 6");
    expect(lastOrderText("2026-10-03T22:30:00Z", "Europe/Oslo")).toBe("4 Oct 2026");
    expect(lastOrderText("not a date", "Europe/Oslo")).toBe(NO_FIGURE);
    expect(lastOrderText("2026-10-03T10:00:00Z", "Not/AZone")).toBe(NO_FIGURE);
  });

  it("says what every customer group means and what to do", () => {
    for (const segment of RFM_SEGMENTS) {
      expect(SEGMENT_COPY[segment].meaning.length).toBeGreaterThan(10);
      expect(SEGMENT_COPY[segment].action.length).toBeGreaterThan(10);
    }
  });
});

// ---------- the empty store ----------

describe("a store with no customers", () => {
  const empty = report({ n: 0 });
  const markup = view(empty);

  it("says calmly that there is nothing yet, and draws no figures", () => {
    expect(words(markup)).toContain("No customers yet");
    expect(words(markup)).toContain("Nothing to show yet.");
    expect(markup).not.toContain('data-state="ok"');
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("data-segment");
    expectClean(markup);
    expectNamedCharts(markup);
  });

  it("shows no zero money or percentage", () => {
    expect(plain(words(markup))).not.toMatch(/0,00|0\.0 %|0 %/);
  });

  it("still shows the notes that apply", () => {
    const text = words(view(report({ n: 0, over: { truncated: true, cap: 5 } })));
    expect(text).toContain("Only the most recent customers are counted");
  });
});

// ---------- a normal store ----------

describe("a normal store", () => {
  const r = report();
  const markup = view(r);
  const text = plain(words(markup));

  it("opens with the three things it answers, then the detail in order", () => {
    const order = ["At a glance", "New and returning customers", "Do customers buy again?", "What a customer is worth", "Customer groups", "Do new customers stay?", "Top customers"].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("Revenue from returning customers");
    expect(text).toContain("Customers who buy again within 90 days");
    expect(text).toContain(r.ltv.predicted.label);
  });

  it("has no page heading of its own (the header has it) and a heading for every section", () => {
    expect(markup).not.toContain("<h1");
    expect(markup.match(/<h2/g)?.length).toBe(7);
    expect(markup.match(/aria-labelledby="cust-[a-z-]+"/g)?.length).toBe(7);
  });

  it("writes only real figures, and every chart has a name", () => {
    expectClean(markup);
    expectNamedCharts(markup);
    expect(markup.match(/<table/g)?.length).toBe(3);
  });

  it("splits new and returning, with the returning share of revenue called out", () => {
    expect(text).toContain("Returning customers' share of revenue");
    expect(text).toContain("New customers");
    expect(text).toContain("Returning customers");
    for (const label of ["Customers", "Orders", "Revenue", "Average order", "Share of customers", "Share of revenue"]) expect(text).toContain(label);
    const nvr = r.newVsReturning;
    expect(nvr.newCustomers).toBeGreaterThan(0);
    expect(nvr.returningCustomers).toBeGreaterThan(0);
    expect(text).toContain(plain(money(nvr.returningRevenueMinor)));
    expect(text).toContain(plain(money(nvr.newRevenueMinor)));
  });

  it("shows the repeat rate for 30, 90, 180 and 365 days with the base each is made of", () => {
    for (const rate of r.repeatRates) {
      expect(text).toContain(`Bought again within ${rate.days} days`);
      if (rate.rate !== null) expect(text).toContain(`${rate.repeaters} of ${rate.base} customers whose first order is at least ${rate.days} days old`);
    }
    expect(text).toContain("Orders per customer per year");
    expect(text).toContain(decimalOf()(r.frequency.perCustomer));
  });

  it("explains the jargon in words, not only in a tooltip", () => {
    expect(text).toContain("A cohort is the group of customers who placed their first order in the same month");
    expect(text).toContain("RFM sorts customers by how Recently they bought, how Frequently and how much Money");
    expect(text).toContain("Lifetime value is what an average customer brings in");
    expect(text).toContain("The repeat purchase rate");
    expect(markup).toContain('title="Of the customers whose first order is at least 30 days old');
  });

  it("shows lifetime value with its basis and the assumption spelled out", () => {
    expect(r.ltv.predicted.basis).toBe("contribution");
    expect(text).toContain("Predicted lifetime contribution");
    expect(text).toContain(plain(money(r.ltv.predicted.minor)));
    expect(text).toContain("profit (contribution) per order");
    expect(text).toContain("It assumes a 3-year lifespan, changed in settings");
    expect(markup).toContain(`href="${BASE}/analytics/settings"`);
    expect(text).toContain("Revenue per customer so far");
    expect(text).toContain("Profit per customer so far");
    expect(cardState(markup, "Profit per customer so far")).toBe("ok");
    expect(cardState(markup, "Revenue per customer so far")).toBe("ok");
    expect(text).not.toContain("costs not entered");
  });

  it("shows the six customer groups as cards with a meaning and an action", () => {
    expect(r.segments.enough).toBe(true);
    expect(markup.match(/data-segment="/g)?.length).toBe(6);
    for (const segment of RFM_SEGMENTS) {
      expect(markup).toContain(`data-segment="${segment}"`);
      expect(text).toContain(SEGMENT_COPY[segment].meaning);
    }
    expect(text).toContain("What to do:");
    expect(text).toContain(SEGMENT_COPY.VIP.action);
  });

  it("draws both cohort tables with a row per month and the lib's trend sentence", () => {
    expect(text).toContain("Share of each month's new customers who had bought again, by months since their first order");
    expect(text).toContain("Revenue per customer of each month's new customers, by months since their first order");
    expect(r.cohorts.rows.length).toBe(13);
    expect(text).toContain("Oct 2025");
    for (const column of ["Same month", "Month 1", "Month 3", "Month 6", "Month 12"]) expect(text).toContain(column);
    expect(text).toContain(r.cohortTrend.sentence);
    // a month that is not over yet is blank, never 0 %
    const lastRow = r.cohorts.rows[r.cohorts.rows.length - 1];
    expect(lastRow.retention.every((v) => v === null)).toBe(true);
  });

  it("lists the top customers, each linking to their admin page", () => {
    expect(markup).toContain(`href="${BASE}/customers/11111111-1111-4111-8111-111111111111"`);
    expect(markup).toContain(`href="${BASE}/customers/22222222-2222-4222-8222-222222222222"`);
    expect(text).toContain("Anna Berg");
    expect(text).toContain("anna@example.com · Has an account");
    expect(text).toContain("guest@example.com");
    expect(text).toContain("Guest");
    expect(text).toContain(plain(money(90_000)));
    expect(text).toContain("12 Oct 2026");
    for (const head of ["Customer", "Orders in period", "Revenue in period", "Orders to date", "Last order"]) expect(text).toContain(head);
  });

  it("says how customers are counted and in what currency", () => {
    expect(text).toContain("How customers are counted");
    expect(text).toContain("Amounts are in NOK without VAT, after refunds");
    expect(text).toContain("Refunds made only in Stripe's own dashboard are not seen");
  });

  it("has no notes of trouble when nothing is wrong", () => {
    expect(markup).not.toContain('data-tone="warning"');
  });

  it("uses only the admin's tokens, never a fixed colour", () => {
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(markup).not.toMatch(/\b(?:text|bg|border)-(?:red|green|blue|gray|slate|zinc|yellow|amber|white|black)\b/);
  });
});

// ---------- the trend sentence ----------

describe("the cohort trend sentence", () => {
  const base = report();

  it("says newer customers come back more often only when the lib says so", () => {
    const better = { ...base.cohortTrend, verdict: "better" as const, sentence: "Newer customers come back more often: 31 % of newer customers had bought again by month 3, against 22 % of older ones." };
    expect(words(view({ ...base, cohortTrend: better }))).toContain("Newer customers come back more often");
    const unknown = { ...base.cohortTrend, verdict: "unknown" as const, sentence: "Not enough customers yet to say whether newer customers come back more or less than older ones." };
    const text = words(view({ ...base, cohortTrend: unknown }));
    expect(text).toContain("Not enough customers yet to say");
    expect(text).not.toContain("come back more often");
  });

  it("states a worse or flat trend as the lib words it", () => {
    for (const verdict of ["worse", "flat"] as const) {
      const sentence = verdict === "worse" ? "Newer customers come back less often: 10 % against 20 %." : "Newer and older customers come back about as often: 20 % against 21 %.";
      expect(words(view({ ...base, cohortTrend: { ...base.cohortTrend, verdict, sentence } }))).toContain(sentence);
    }
  });
});

// ---------- missing costs ----------

describe("a store that has not entered its costs", () => {
  const r = report({ costs: "none" });
  const markup = view(r);
  const text = plain(words(markup));

  it("calls the predicted value revenue, never profit, and says so", () => {
    expect(r.ltv.predicted.basis).toBe("revenue");
    expect(text).toContain("Predicted lifetime revenue (costs not entered)");
    expect(text).not.toContain("Predicted lifetime contribution");
    expect(text).toContain("revenue per order");
    expect(text).not.toContain("profit (contribution) per order");
    expect(text).toContain("Product costs are not entered, so this is based on revenue and says so. It is not profit.");
  });

  it("shows profit per customer as missing with a prompt, never as a zero", () => {
    expect(r.ltv.historic.contributionMinor).toBeNull();
    expect(cardState(markup, "Profit per customer so far")).toBe("missing");
    expect(text).toContain("Product costs are not entered, so profit per customer cannot be worked out.");
    expect(markup).toContain(`href="${BASE}/products"`);
    expect(text).toContain("Enter what your products cost");
    expect(text).not.toMatch(/Profit per customer so far\s*(?:0|0,00)/);
  });

  it("is still clean and keeps its charts named", () => {
    expectClean(markup);
    expectNamedCharts(markup);
  });
});

describe("a store with costs for only some customers", () => {
  const r = report({ costs: "partial" });
  const markup = view(r);
  const text = plain(words(markup));

  it("says how many customers the profit figures rest on", () => {
    expect(r.ltv.historic.contributionCoverage).not.toBeNull();
    expect(r.ltv.historic.contributionCoverage as number).toBeLessThan(1);
    expect(text).toContain(`Known for ${Math.round((r.ltv.historic.contributionCoverage as number) * 100)} % of customers`);
    expect(text).toContain(`Profit per order is worked out from ${r.ltv.inputs.contributionCustomers} of ${r.ltv.historic.customers} customers`);
    expect(cardState(markup, "Profit per customer so far")).toBe("ok");
    expectClean(markup);
  });
});

// ---------- currencies, truncation ----------

describe("partial currency coverage and a capped read", () => {
  const r = report({ over: { unconverted: 4, missingRates: ["SEK", "DKK"], truncated: true, cap: 200_000 } });
  const markup = view(r);
  const text = plain(words(markup));

  it("names the customers and currencies left out, and never counts them as zero", () => {
    expect(text).toContain("Some amounts could not be converted");
    expect(text).toContain("4 customers bought in SEK, DKK, which has no exchange rate");
    expect(text).toContain("They are not counted as zero");
    expect(markup).toContain(`href="${BASE}/settings/localization"`);
  });

  it("says the oldest customers are missing when the read was capped", () => {
    expect(text).toContain("Only the most recent customers are counted");
    expect(text).toContain("more than 200 000 customers");
  });

  it("warns with a word and an icon, not colour alone", () => {
    expect(markup.match(/data-tone="warning"/g)?.length).toBe(2);
    expect(markup.match(/role="note"/g)?.length).toBe(3);
    expectClean(markup);
  });

  it("says one customer in the singular, and sends a non-owner to an owner", () => {
    const one = view(report({ over: { unconverted: 1, missingRates: ["SEK"] } }), { isOwner: false });
    expect(plain(words(one))).toContain("1 customer bought in SEK");
    expect(plain(words(one))).toContain("An owner can add the rate in Languages and currencies.");
    expect(one).not.toContain("/settings/localization");
  });
});

// ---------- small groups ----------

describe("small numbers", () => {
  it("calls a repeat rate over a small base a rough guide", () => {
    const r = report({ n: 40 });
    const small = r.repeatRates.filter((x) => x.rate !== null && x.base < SMALL_BASE);
    expect(small.length).toBeGreaterThan(0);
    expect(words(view(r))).toContain("rough guide");
  });

  it("shows a window nobody has reached as missing, with the reason", () => {
    // every customer is a week old: no window has anyone old enough
    const r = { ...report({ n: 20 }), repeatRates: repeatRates([{ firstOrderAt: "2026-10-08T10:00:00Z", secondOrderAt: null }], NOW) };
    const none = r.repeatRates.filter((x) => x.rate === null);
    expect(none.length).toBe(4);
    const markup = view(r);
    for (const x of none) {
      expect(cardState(markup, `Bought again within ${x.days} days`)).toBe("missing");
      expect(words(markup)).toContain(`No customer has been with you ${x.days} days yet`);
    }
    expectClean(markup);
  });

  it("does not sort a few customers into groups", () => {
    const r = report({ n: 12 });
    expect(r.segments.enough).toBe(false);
    const markup = view(r);
    expect(words(markup)).toContain("Too few customers to sort into groups");
    expect(words(markup)).toContain(`at least ${RFM_MIN_CUSTOMERS} customers, and you have 12 so far`);
    expect(markup).not.toContain("data-segment");
    expectClean(markup);
  });

  it("warns that cohorts of fewer than twenty swing a lot", () => {
    expect(words(view(report({ n: 130 })))).toContain("Months with fewer than 20 new customers swing a lot");
    expect(words(view(report()))).not.toContain("swing a lot");
  });

  it("leaves an empty group calm: no averages, no action", () => {
    const r = report();
    const summary = r.segments.summary.map((s) => (s.segment === "Lost" ? { ...s, customers: 0, customerShare: 0, revenueMinor: 0, revenueShare: 0, averageRevenueMinor: null, averageOrders: null, averageRecencyDays: null } : s));
    const markup = view({ ...r, segments: { ...r.segments, summary } });
    const lost = /data-segment="Lost"[\s\S]*?<\/li>/.exec(markup)?.[0] ?? "";
    expect(words(lost)).toContain("No customers in this group right now.");
    expect(words(lost)).not.toContain("What to do:");
    expectClean(markup);
  });
});

// ---------- a period without orders ----------

describe("a period in which nobody ordered", () => {
  const r = report({ periodCustomers: false, top: [] });
  const markup = view(r);
  const text = words(markup);

  it("keeps the whole-history figures and says calmly that the period is empty", () => {
    expect(text).toContain("Nobody placed a paid order in this period, so there is nothing to split into new and returning.");
    expect(cardState(markup, "Revenue from returning customers")).toBe("missing");
    expect(text).toContain("Nobody ordered in this period.");
    expect(text).toContain("Nobody placed a paid order in this period.");
    expect(cardState(markup, "Customers who buy again within 90 days")).toBe("ok");
    expect(markup).toContain("data-segment");
    expectClean(markup);
    expectNamedCharts(markup);
  });

  it("draws no new-and-returning cards of zeros", () => {
    expect(text).not.toContain("Share of customers");
  });
});

// ---------- a customer that has not ordered for a year, no name ----------

describe("odd but valid data", () => {
  it("copes with a report whose figures are all unknown", () => {
    const r = report();
    const markup = view({
      ...r,
      frequency: { orders365: 0, customers365: 0, perCustomer: null },
      ltv: {
        historic: { customers: 0, revenueMinor: null, contributionMinor: null, contributionCoverage: null },
        predicted: { minor: null, basis: null, label: "Predicted lifetime value" },
        inputs: { contributionPerOrderMinor: null, revenuePerOrderMinor: null, ordersPerYear: null, lifespanYears: 3, contributionCustomers: 0, contributionOrders: 0 },
      },
      repeatRates: r.repeatRates.map((x) => ({ ...x, base: 0, repeaters: 0, rate: null })),
      newVsReturning: { ...r.newVsReturning, returningShare: null, returningRevenueShare: null },
      cohorts: { offsets: r.cohorts.offsets, rows: [] },
      cohortTrend: { ...r.cohortTrend, verdict: "unknown" },
    });
    expectClean(markup);
    expectNamedCharts(markup);
    expect(words(markup)).toContain("There are no paid orders to work from yet.");
    expect(cardState(markup, "Orders per customer per year")).toBe("missing");
    expect(words(markup)).toContain("No paid orders in the last 365 days.");
    expect(words(markup)).toContain("No cohorts yet.");
  });

  it("says nobody has ordered lately when there is no frequency to predict from", () => {
    const r = report();
    const markup = view({
      ...r,
      frequency: { orders365: 0, customers365: 0, perCustomer: null },
      ltv: { ...r.ltv, predicted: { minor: null, basis: "contribution", label: "Predicted lifetime contribution" }, inputs: { ...r.ltv.inputs, ordersPerYear: null } },
    });
    expect(words(markup)).toContain("Nobody has ordered in the last 365 days, so how often customers buy is not known yet.");
    expectClean(markup);
  });

  it("links a customer's name by its id, encoded, and falls back to the email", () => {
    const odd: TopCustomer = { ...TOP[1], customerId: "a b/c", name: null };
    const markup = view(report({ top: [odd] }));
    expect(markup).toContain(`href="${BASE}/customers/a%20b%2Fc"`);
    expect(words(markup)).toContain("guest@example.com");
  });
});

// ---------- who sees what ----------

describe("a member who is not an owner", () => {
  const markup = view(report({ costs: "none" }), { isOwner: false });
  const text = words(markup);

  it("is not sent to settings only an owner can open", () => {
    expect(markup).not.toContain("/analytics/settings");
    expect(text).toContain("changed in the analytics settings by an owner");
  });

  it("can still enter product costs, which any member can", () => {
    expect(markup).toContain(`href="${BASE}/products"`);
    expectClean(markup);
  });
});

describe("the page at phone width", () => {
  it("lets tables scroll in their own box and stacks the cards", () => {
    const markup = view(report());
    expect(markup.match(/overflow-x-auto/g)?.length).toBeGreaterThanOrEqual(3);
    expect(markup).toContain("grid-cols-1");
    expect(markup).not.toMatch(/max-w-\d?xl/);
  });
});
