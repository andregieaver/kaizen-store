import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { arr, mrrMovements } from "@/lib/analytics-subscriptions";
import type { SubscriptionsReport } from "@/server/analytics-subscriptions-data";

import { dayText, moneyWriter } from "./overview-view";
import {
  bridgeRows,
  churnCards,
  durationText,
  growthLine,
  hasNoSubscriptions,
  headlineCards,
  periodText,
  renewalCards,
  safeMoney,
  signedMoney,
  SubscriptionsView,
  type SubscriptionsViewProps,
} from "./subscriptions-view";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const text = (props: SubscriptionsViewProps) =>
  renderToString(h(SubscriptionsView, props))
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

const NOT_TRACKED: SubscriptionsReport["notTracked"] = [
  { key: "expansion", label: "Expansion", why: "A subscription's price or quantity is kept only as it is now, so an increase cannot be told from a new subscription." },
  { key: "contraction", label: "Contraction", why: "A subscription's price or quantity is kept only as it is now, so a decrease cannot be seen." },
  { key: "reactivation", label: "Reactivation", why: "There is no status history, so a return cannot be told from a new subscription." },
  { key: "history", label: "Paused and failed payments over time", why: "Only today's status is kept: past-due and paused subscriptions are a snapshot, and earlier periods count them as active." },
];

/** A store with no subscription at all, the way `subscriptionsReport()` gives it. */
function emptyReport(over: Partial<SubscriptionsReport> = {}): SubscriptionsReport {
  return {
    currency: "NOK",
    period: { from: "2026-09-01", to: "2026-10-01", days: 30 },
    today: "2026-10-02",
    now: "2026-10-02T09:00:00.000Z",
    active: { count: 0, mrrMinor: 0, arrMinor: 0 },
    pastDue: { count: 0, mrrMinor: 0, snapshot: true },
    trialing: { count: 0, mrrMinor: 0 },
    paused: { count: 0, mrrMinor: 0 },
    cancelling: { count: 0, mrrMinor: 0 },
    new: { count: 0, mrrMinor: 0 },
    cancelled: { count: 0, mrrMinor: 0, fromStart: 0 },
    activeAtStart: { count: 0, mrrMinor: 0 },
    activeAtEnd: { count: 0, mrrMinor: 0, basis: "periodEnd" },
    churn: { rate: null, revenueRate: null, lowVolume: true },
    movements: mrrMovements({ startMrr: 0, newMrr: 0, churnedMrr: 0, endMrr: 0 }, 0),
    renewals: { orders: 0, revenueMinor: 0, aovMinor: null },
    firstOrders: { orders: 0, revenueMinor: 0 },
    aovMinor: null,
    duration: { endedInPeriod: 0, avgDaysInPeriod: null, endedTotal: 0, avgDaysTotal: null },
    notTracked: NOT_TRACKED,
    unconverted: { subscriptions: 0, orders: 0 },
    missingRates: [],
    truncated: false,
    notes: [],
    ...over,
  };
}

/** A store that is working: 120 subscribers at the start, some won, some lost, some in failed payment, a period reaching today. */
function normalReport(over: Partial<SubscriptionsReport> = {}): SubscriptionsReport {
  const start = 120 * 30_000;
  const created = 18 * 30_000;
  const churned = 6 * 30_000;
  const end = 130 * 30_000 + 5_000;
  return emptyReport({
    period: { from: "2026-09-03", to: "2026-10-03", days: 30 },
    active: { count: 130, mrrMinor: end, arrMinor: arr(end) },
    pastDue: { count: 4, mrrMinor: 4 * 30_000, snapshot: true },
    trialing: { count: 3, mrrMinor: 90_000 },
    paused: { count: 2, mrrMinor: 60_000 },
    cancelling: { count: 5, mrrMinor: 150_000 },
    new: { count: 18, mrrMinor: created },
    cancelled: { count: 6, mrrMinor: churned, fromStart: 5 },
    activeAtStart: { count: 120, mrrMinor: start },
    activeAtEnd: { count: 130, mrrMinor: end, basis: "now" },
    churn: { rate: 6 / 120, revenueRate: churned / start, lowVolume: false },
    movements: mrrMovements({ startMrr: start, newMrr: created, churnedMrr: churned, endMrr: end }, 0),
    renewals: { orders: 240, revenueMinor: 240 * 28_000, aovMinor: 28_000 },
    firstOrders: { orders: 18, revenueMinor: 18 * 27_000 },
    aovMinor: Math.round((240 * 28_000 + 18 * 27_000) / 258),
    duration: { endedInPeriod: 6, avgDaysInPeriod: 142.4, endedTotal: 40, avgDaysTotal: 200.2 },
    ...over,
  });
}

const props = (report: SubscriptionsReport, over: Partial<SubscriptionsViewProps> = {}): SubscriptionsViewProps => ({
  base: "/admin/shop",
  currency: "NOK",
  locale: "nb-NO",
  report,
  ...over,
});

// ---------- helpers ----------

describe("helpers", () => {
  it("writes a length of time the way a person says it", () => {
    expect(durationText(0.4)).toBe("less than a day");
    expect(durationText(1)).toBe("1 day");
    expect(durationText(12.4)).toBe("12 days");
    expect(durationText(142.4)).toBe("about 5 months");
    expect(durationText(900)).toBe("about 2.5 years");
    expect(durationText(null)).toBe("–");
    expect(durationText(Number.NaN)).toBe("–");
    expect(durationText(-3)).toBe("–");
  });

  it("writes amounts safely, with a dash for what cannot be written", () => {
    const write = safeMoney("NOK", "nb-NO");
    expect(write(150_000)).toContain("1");
    expect(write(null)).toBe("–");
    expect(write(Number.NaN)).toBe("–");
    expect(write(Number.POSITIVE_INFINITY)).toBe("–");
  });

  it("writes a signed amount: plus, minus, and none for zero", () => {
    const write = safeMoney("NOK", "nb-NO");
    expect(signedMoney(write, 100_000).startsWith("+")).toBe(true);
    expect(signedMoney(write, -100_000).startsWith("−")).toBe(true);
    expect(signedMoney(write, 0)).toBe(write(0));
    expect(signedMoney(write, -0)).toBe(write(0));
    expect(signedMoney(write, null)).toBe("–");
  });

  it("writes the period as dates, the day after the last one left out", () => {
    // The month's short name is the shared one ("Sep", never the runtime's "Sept").
    expect(periodText({ from: "2026-09-01", to: "2026-10-01" })).toBe("1 Sep 2026 to 30 Sep 2026");
    expect(periodText({ from: "2026-10-02", to: "2026-10-03" })).toBe(dayText("2026-10-02"));
  });

  it("knows a store that has never had a subscription, and one that merely has none today", () => {
    expect(hasNoSubscriptions(emptyReport())).toBe(true);
    expect(hasNoSubscriptions(normalReport())).toBe(false);
    // All of them ended long ago: there is a history, so the page is not the empty state.
    expect(hasNoSubscriptions(emptyReport({ duration: { endedInPeriod: 0, avgDaysInPeriod: null, endedTotal: 3, avgDaysTotal: 90 } }))).toBe(false);
    // Something was left out: it exists.
    expect(hasNoSubscriptions(emptyReport({ unconverted: { subscriptions: 2, orders: 0 }, notes: ["2 subscriptions in SEK are left out."] }))).toBe(false);
    expect(hasNoSubscriptions(emptyReport({ paused: { count: 1, mrrMinor: 100 } }))).toBe(false);
  });
});

describe("the bridge", () => {
  it("lays out start, new, the three untracked movements, churned, other and end, in that order", () => {
    const rows = bridgeRows(normalReport());
    expect(rows.map((r) => r.key)).toEqual(["start", "new", "expansion", "contraction", "reactivation", "churned", "other", "end"]);
  });

  it("adds up: start + new - churned + other = end", () => {
    const r = normalReport();
    const rows = bridgeRows(r);
    const get = (k: string) => rows.find((x) => x.key === k)!.amountMinor!;
    expect(get("start") + get("new") + get("churned") + get("other")).toBe(get("end"));
    expect(get("churned")).toBeLessThan(0);
  });

  it("never turns an untracked movement into a number", () => {
    const rows = bridgeRows(normalReport());
    for (const key of ["expansion", "contraction", "reactivation"]) {
      const row = rows.find((x) => x.key === key)!;
      expect(row.amountMinor).toBeNull();
      expect(row.detail.length).toBeGreaterThan(20);
    }
  });

  it("names the end 'today' when the period reaches today, else the end of the period", () => {
    expect(bridgeRows(normalReport()).find((r) => r.key === "end")!.label).toBe("MRR today");
    expect(bridgeRows(normalReport({ activeAtEnd: { count: 100, mrrMinor: 1, basis: "periodEnd" } })).find((r) => r.key === "end")!.label).toBe("MRR at the end");
  });

  it("words the growth, and says when there is no rate to give", () => {
    const write = safeMoney("NOK", "nb-NO");
    expect(growthLine(normalReport(), write)).toMatch(/grew by .* \(\+/);
    const shrunk = normalReport({ movements: mrrMovements({ startMrr: 100_000, newMrr: 0, churnedMrr: 20_000, endMrr: 80_000 }, 0) });
    expect(growthLine(shrunk, write)).toMatch(/fell by .* \(−20\.0 %\)/);
    const fromNothing = normalReport({ movements: mrrMovements({ startMrr: 0, newMrr: 50_000, churnedMrr: 0, endMrr: 50_000 }, 0) });
    expect(growthLine(fromNothing, write)).toMatch(/no recurring revenue when this period began, so there is no growth rate/);
    expect(growthLine(emptyReport(), write)).toMatch(/no recurring revenue at the start or the end/);
    const flat = normalReport({ movements: mrrMovements({ startMrr: 100_000, newMrr: 0, churnedMrr: 0, endMrr: 100_000 }, 0) });
    expect(growthLine(flat, write)).toMatch(/did not change/);
  });
});

describe("the cards", () => {
  it("shows MRR, ARR, subscribers and the MRR at risk", () => {
    const cards = headlineCards(props(normalReport()));
    expect(cards.map((c) => c.label)).toEqual(["Monthly recurring revenue (MRR)", "Annual recurring revenue (ARR)", "Active subscribers", "MRR at risk (failed payments)"]);
    expect(cards[0].value).toBe(money(130 * 30_000 + 5_000));
    expect(cards[1].value).toBe(money(12 * (130 * 30_000 + 5_000)));
    expect(cards[3].hint).toMatch(/A snapshot of today/);
  });

  it("explains an acronym on every card that uses one", () => {
    const all = [...headlineCards(props(normalReport())), ...churnCards(props(normalReport())), ...renewalCards(props(normalReport()))];
    for (const card of all) expect(card.help, card.label).toBeTruthy();
  });

  it("says a churn rate with no start has nothing to compare with, and never shows it as 0 %", () => {
    const cards = churnCards(props(normalReport({ activeAtStart: { count: 0, mrrMinor: 0 }, churn: { rate: null, revenueRate: null, lowVolume: true } })));
    expect(cards[0].state).toBe("missing");
    expect(cards[0].value).toBeNull();
    expect(cards[1].state).toBe("missing");
    expect(cards[0].missing?.text).toMatch(/No subscription was active when this period began/);
  });

  it("flags a churn rate over few subscriptions", () => {
    const cards = churnCards(props(normalReport({ activeAtStart: { count: 8, mrrMinor: 240_000 }, cancelled: { count: 2, mrrMinor: 60_000, fromStart: 2 }, churn: { rate: 0.25, revenueRate: 0.25, lowVolume: true } })));
    expect(cards[0].value).toBe("25.0 %");
    expect(cards[0].hint).toMatch(/Only 8 subscriptions were active at the start, so one cancellation moves this a lot/);
  });

  it("does not flag a churn rate over many", () => {
    expect(churnCards(props(normalReport()))[0].hint).not.toMatch(/Only/);
  });

  it("prefers the length of subscriptions that ended in the period and falls back to all time, or to nothing", () => {
    const inPeriod = churnCards(props(normalReport()))[2];
    expect(inPeriod.value).toBe("about 5 months");
    expect(inPeriod.hint).toMatch(/ended in this period/);
    const allTime = churnCards(props(normalReport({ duration: { endedInPeriod: 0, avgDaysInPeriod: null, endedTotal: 3, avgDaysTotal: 90 } })))[2];
    expect(allTime.value).toBe("about 3 months");
    expect(allTime.hint).toMatch(/None ended in this period/);
    const none = churnCards(props(normalReport({ duration: { endedInPeriod: 0, avgDaysInPeriod: null, endedTotal: 0, avgDaysTotal: null } })))[2];
    expect(none.state).toBe("missing");
  });

  it("keeps a period with no renewals from reading as 0 revenue", () => {
    const cards = renewalCards(props(emptyReport({ active: { count: 5, mrrMinor: 50_000, arrMinor: 600_000 } })));
    for (const c of cards) {
      expect(c.state).toBe("missing");
      expect(c.value).toBeNull();
    }
  });
});

// ---------- the page ----------

describe("SubscriptionsView, a store with no subscriptions", () => {
  const out = text(props(emptyReport()));

  it("is a calm empty state with no figures and no NaN", () => {
    expect(out).toContain("No subscriptions yet");
    expect(out).toContain("no recurring revenue to show");
    expect(out).not.toMatch(BAD);
    expect(out).not.toContain("0,00");
  });

  it("says what appears here and where to start", () => {
    expect(out).toContain("/admin/shop/products");
    expect(out).toContain("/admin/shop/subscriptions");
    expect(out).toContain("MRR");
  });

  it("draws no chart and no KPI card", () => {
    expect(out).not.toContain("<svg");
    expect(out).not.toContain('data-state="ok"');
  });
});

describe("SubscriptionsView, a normal store", () => {
  const out = text(props(normalReport()));

  it("answers 'how much recurring revenue do we have' first", () => {
    expect(out.indexOf("Recurring revenue today")).toBeGreaterThan(-1);
    expect(out.indexOf("Recurring revenue today")).toBeLessThan(out.indexOf("How MRR moved"));
    expect(out.indexOf("How MRR moved")).toBeLessThan(out.indexOf("Who left"));
    expect(out.indexOf("Who left")).toBeLessThan(out.indexOf("What subscriptions earned"));
    expect(out).toContain(money(130 * 30_000 + 5_000));
  });

  it("explains MRR, ARR and churn in a title on the card", () => {
    expect(out).toContain("Monthly recurring revenue: what your active subscriptions bring in each month");
    expect(out).toContain("Churn rate: the share of the subscriptions that were active when the period began");
    expect(out).toContain("Annual recurring revenue: twelve months of MRR");
  });

  it("labels the failed-payment figure as a snapshot of today", () => {
    expect(out).toContain("Failed payments are a snapshot");
    expect(out).toContain("Kaizen keeps no history of failed payments");
    expect(out).toContain(money(4 * 30_000));
  });

  it("shows the bridge with the untracked rows as dashes and says so in words", () => {
    for (const row of ["expansion", "contraction", "reactivation"]) {
      const cell = out.match(new RegExp(`data-step="${row}"[\\s\\S]*?</tr>`))![0];
      expect(cell).toContain("Not tracked");
      expect(cell).not.toMatch(/\d\s?kr/);
    }
    expect(out).toContain("Expansion, contraction and reactivation are not tracked");
    expect(out).toContain("These rows show a dash, not 0");
    expect(out).toContain("MRR today");
  });

  it("shows churn with its counts, and renewals with their count", () => {
    expect(out).toContain("5.0 %");
    expect(out).toContain("6 cancelled out of 120 active at the start");
    expect(out).toContain("From 240 paid renewals");
  });

  it("calls out what is already set to end and what is in a trial", () => {
    expect(out).toContain("Already set to end");
    expect(out).toContain("3 are still in a free trial");
  });

  it("lists what the page cannot see", () => {
    expect(out).toContain("What this page cannot see");
    expect(out).toContain("Reactivation: ");
    expect(out).toContain("Paused and failed payments over time: ");
  });

  it("has no NaN, Infinity or undefined anywhere", () => {
    expect(out).not.toMatch(BAD);
  });

  it("gives every chart and table a name", () => {
    const svgs = [...out.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]).filter((s) => /role="img"/.test(s));
    for (const s of svgs) expect(s).toMatch(/aria-label="[^"]{3,}"/);
    const lists = [...out.matchAll(/<ol\b[^>]*>/g)].map((m) => m[0]);
    expect(lists.length).toBeGreaterThan(0);
    for (const l of lists) expect(l).toMatch(/aria-label="[^"]{3,}"/);
    const tables = [...out.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => m[0]);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(t).toMatch(/<caption/);
  });

  it("works with no script: no client component or form to run", () => {
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onClick");
  });
});

describe("SubscriptionsView, edge cases", () => {
  it("tells a period that ended in the past from one that reaches today", () => {
    const past = text(props(normalReport({ activeAtEnd: { count: 110, mrrMinor: 3_100_000, basis: "periodEnd" } })));
    expect(past).toContain("MRR at the end");
    expect(past).not.toMatch(BAD);
  });

  it("shows partial currency coverage as a warning with the sentence the report wrote", () => {
    const note = "3 subscriptions and 12 orders in SEK are left out: the store has no exchange rate for it.";
    const out = text(props(normalReport({ unconverted: { subscriptions: 3, orders: 12 }, missingRates: ["SEK"], notes: [note] })));
    expect(out).toContain(note);
    expect(out).toContain('data-tone="warning"');
  });

  it("shows a store whose only subscriptions are in a currency without a rate as having something, not as empty", () => {
    const note = "4 subscriptions and 0 orders in SEK are left out: the store has no exchange rate for it.";
    const out = text(props(emptyReport({ unconverted: { subscriptions: 4, orders: 0 }, missingRates: ["SEK"], notes: [note] })));
    expect(out).not.toContain("No subscriptions yet");
    expect(out).toContain(note);
    expect(out).not.toMatch(BAD);
  });

  it("shows no MRR as a known zero with a plain sentence, while every unknown stays a dash", () => {
    const out = text(props(emptyReport({ duration: { endedInPeriod: 0, avgDaysInPeriod: null, endedTotal: 3, avgDaysTotal: 90 } })));
    expect(out).toContain("No active subscriptions today.");
    expect(out).toContain("No subscription was active when this period began");
    expect(out).toContain("No renewal was paid in this period.");
    expect(out).not.toMatch(BAD);
  });

  it("has no failed-payment warning when none is in failed payment, and says so on the card", () => {
    const out = text(props(normalReport({ pastDue: { count: 0, mrrMinor: 0, snapshot: true } })));
    expect(out).not.toContain("Failed payments are a snapshot");
    expect(out).toContain("No subscription is in failed payment today.");
  });

  it("handles a store where only paused subscriptions are left", () => {
    const out = text(props(emptyReport({ paused: { count: 2, mrrMinor: 60_000 }, activeAtStart: { count: 2, mrrMinor: 60_000 }, movements: mrrMovements({ startMrr: 60_000, newMrr: 0, churnedMrr: 0, endMrr: 0 }, 0) })));
    expect(out).toContain("Other changes");
    expect(out).toContain("fell by");
    expect(out).not.toMatch(BAD);
  });

  it("links the failed payments to the subscriptions list", () => {
    const out = text(props(normalReport()));
    expect(out).toContain('href="/admin/shop/subscriptions"');
  });
});
