import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/db/client";
import { addDays, parseAnalyticsParams } from "@/lib/analytics-period";

import type { Store } from "./stores";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
// The real inventory report, but one a test can make fail.
vi.mock("./analytics-inventory-data", async (importOriginal) => {
  const real = await importOriginal<typeof import("./analytics-inventory-data")>();
  return { ...real, inventoryReport: vi.fn(real.inventoryReport) };
});

const fixture = await import("./analytics-insights-fixture");
const insights = await import("./analytics-insights");
const inventory = await import("./analytics-inventory-data");

/**
 * The insights of a store (D152): the alerts, the forecast and the diagnosis, assembled from the store's own reports (docs/analytics.md).
 * The stores are built by hand around one fixed moment (`analytics-insights-fixture.ts`, where the busy store's orders, visits and mugs are
 * written out): a busy one with a conversion drop, a refund spike and a stockout, a steady one and a quiet one.
 */

let busy: Store;
let steady: Store;
let quiet: Store;
let today: string;

beforeAll(async () => {
  busy = await fixture.makeStore("insights-busy", true);
  steady = await fixture.makeStore("insights-steady", false);
  quiet = await fixture.makeStore("insights-quiet", false);
  today = fixture.todayOf(busy);
  await fixture.seedBusyStore(busy);
  await fixture.seedSteadyStore(steady);
});

afterAll(async () => {
  await closeDb();
});

const WORDS = /NaN|undefined|Infinity|\[object/;

describe("alertsForStore", () => {
  it("raises a conversion drop, a stockout and a refund spike for the busy store, with figures and no broken text", async () => {
    const alerts = await insights.alertsForStore(busy, fixture.NOW);
    const ids = alerts.map((a) => a.id);
    expect(ids).toContain("conversion-drop");
    expect(ids).toContain("stockout");
    expect(ids).toContain("refund-rate");

    const conversion = alerts.find((a) => a.id === "conversion-drop")!;
    // 4 orders over 770 visits against 56 + 8 orders over 1 680 + 7 x 60 visits: down by far more than 40 %.
    expect(conversion.severity).toBe("urgent");
    expect(conversion.text).toContain("lower over the last 7 days");
    expect(conversion.href).toBe("/analytics/traffic");

    const stock = alerts.find((a) => a.id === "stockout")!;
    expect(stock.severity).toBe("urgent");
    expect(stock.text).toContain("Keramikkrus");

    const refunds = alerts.find((a) => a.id === "refund-rate")!;
    expect(refunds.text).toContain("Keramikkrus");
    expect(refunds.text).toContain("3 of 8");
    expect(refunds.href).toBe("/analytics/products?sort=refunds");

    for (const a of alerts) {
      expect(`${a.text} ${a.action} ${JSON.stringify(a.evidence)}`).not.toMatch(WORDS);
      expect(a.href.startsWith("/")).toBe(true);
    }
    // Urgent first.
    expect(alerts[0].severity).toBe("urgent");
  });

  it("says nothing at all for a quiet store, and nothing for a steady one that has no visit counting and sells at its usual pace", async () => {
    expect(await insights.alertsForStore(quiet, fixture.NOW)).toEqual([]);
    expect(await insights.alertsForStore(steady, fixture.NOW)).toEqual([]);
  });

  it("reads how much of the last 28 days' sales have a product cost, from the totals", async () => {
    const { costs } = await insights.alertSnapshotFor(busy, fixture.NOW);
    // The mug lines have no cost entered; the plain orders have no line to cost. Some 20 orders, a share of their sales costed.
    expect(costs?.orders).toBeGreaterThanOrEqual(10);
    expect(costs?.coverage).toBeGreaterThan(0);
    expect(costs?.coverage).toBeLessThan(1);
  });

  it("builds the snapshot from the store's own reports: the daily history, refunds by product, visits and the stock", async () => {
    const snapshot = await insights.alertSnapshotFor(busy, fixture.NOW);
    expect(snapshot.today).toBe(today);
    expect(snapshot.dayShare).toBeCloseTo(14 / 24, 5);
    expect(snapshot.currency).toBe(busy.markets[0].currency);
    // The history starts at the store's first sale in the window (the mug's order 88 days ago), and every day in it is there.
    expect(snapshot.daily[0].day).toBe(addDays(today, -88));
    expect(snapshot.daily).toHaveLength(89);
    expect(snapshot.daily.at(-1)?.day).toBe(today);
    const week = snapshot.daily.filter((d) => d.day >= addDays(today, -7) && d.day < today);
    expect(week.reduce((n, d) => n + (d.sessions ?? 0), 0)).toBe(770);
    // Before the first counted day the visits are not known, never 0.
    expect(snapshot.daily.find((d) => d.day === addDays(today, -80))?.sessions).toBeNull();
    expect(snapshot.daily.find((d) => d.day === addDays(today, -40))?.sessions).toBe(60);
    expect(snapshot.productRefunds).toEqual([expect.objectContaining({ name: expect.stringContaining("Keramikkrus"), sold14: 8, refunded14: 3, soldBaseline: expect.any(Number), refundedBaseline: 0 })]);
    expect(snapshot.stockouts?.map((s) => s.kind)).toContain("out");
    expect(snapshot.target).toBeNull();
  });

  it("lets one failing report fail alone: the other alerts stay and nothing throws", async () => {
    vi.mocked(inventory.inventoryReport).mockRejectedValueOnce(new Error("secret: connection string"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const alerts = await insights.alertsForStore(busy, fixture.NOW);
    const ids = alerts.map((a) => a.id);
    expect(ids).toContain("conversion-drop");
    expect(ids).toContain("refund-rate");
    expect(ids).not.toContain("stockout");
    // What is logged is the report and the kind of error, never the message.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("stock");
    expect(String(warn.mock.calls[0][0])).not.toContain("secret");
    warn.mockRestore();
  });

  it("returns nothing, never throws, when even the history cannot be read", async () => {
    const broken = { ...busy, id: "not-a-uuid" } as unknown as Store;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(insights.alertsForStore(broken, fixture.NOW)).resolves.toEqual([]);
    warn.mockRestore();
  });
});

describe("forecastForStore", () => {
  it("forecasts the month with a range for a store with history, from net revenue per day", async () => {
    const f = await insights.forecastForStore(busy, fixture.NOW);
    expect(f).not.toBeNull();
    expect(f!.monthStart).toBe("2026-10-01");
    expect(f!.forecast.basis).not.toBe("too-little-data");
    const { expectedMinor, lowMinor, highMinor, soFarMinor } = f!.forecast;
    expect(expectedMinor).not.toBeNull();
    expect(lowMinor! <= expectedMinor! && expectedMinor! <= highMinor!).toBe(true);
    // What is banked is a floor, and what was sold this month is in it (the 3 refunded mug orders' refunds are taken off).
    expect(lowMinor!).toBeGreaterThanOrEqual(soFarMinor);
    expect(f!.targetMinor).toBeNull();
    expect(JSON.stringify(f)).not.toMatch(WORDS);
  });

  it("says too little history, with no figures (never zero), for a store with no sales", async () => {
    const f = await insights.forecastForStore(quiet, fixture.NOW);
    expect(f!.forecast.basis).toBe("too-little-data");
    expect(f!.forecast.expectedMinor).toBeNull();
    expect(f!.forecast.lowMinor).toBeNull();
    expect(f!.forecast.highMinor).toBeNull();
    expect(JSON.stringify(f)).not.toMatch(WORDS);
  });

  it("shares one daily history between the alerts, the forecast and the target", async () => {
    const history = insights.dailyHistory(busy, fixture.NOW);
    const [alerts, forecast] = await Promise.all([insights.alertsForStore(busy, fixture.NOW, { history }), insights.forecastForStore(busy, fixture.NOW, { history })]);
    expect(alerts.length).toBeGreaterThan(0);
    expect(forecast?.forecast.basis).not.toBe("too-little-data");
    const progress = insights.targetFrom(await history, 5_000_000);
    expect(progress.targetMinor).toBe(5_000_000);
    expect(progress.actualMinor).toBe((await history).days.filter((d) => d.day >= "2026-10-01").reduce((n, d) => n + d.netRevenueMinor, 0));
  });
});

describe("diagnosisFor", () => {
  const params = (query: Record<string, string>, store: Store) => parseAnalyticsParams(query, { now: fixture.NOW, timeZone: store.timeZone });

  it("explains a fall in conversion as traffic, conversion and average order, with the shares adding to 100", async () => {
    const d = await insights.diagnosisFor(busy, params({ period: "7d", compare: "previous" }, busy), fixture.NOW);
    expect(d).not.toBeNull();
    const e = d!.explanation;
    expect(e.direction).toBe("down");
    expect(e.factors.map((f) => f.key)).toEqual(["traffic", "conversion", "basket"]);
    expect(e.factors.reduce((sum, f) => sum + (f.sharePct ?? 0), 0)).toBe(100);
    expect(e.sentences.length).toBeGreaterThan(1);
    expect(d!.basis).toContain("before refunds");
    expect(d!.comparedWith.to).toBe(d!.period.from);
    expect(JSON.stringify(d)).not.toMatch(WORDS);
  });

  it("leaves out devices and channels, and says why, when visits were not counted for both periods", async () => {
    // Sixty days against the sixty before them: visits are counted from the 60th day before today, so the earlier period is only partly covered.
    const d = await insights.diagnosisFor(busy, params({ period: "custom", from: addDays(today, -59), to: today, compare: "previous" }, busy), fixture.NOW);
    expect(d!.notes.join(" ")).toContain("Visits were not counted for the whole of both periods");
    expect(d!.explanation.factors.map((f) => f.key)).toEqual(["orders", "basket"]);
    const off = await insights.diagnosisFor(steady, params({ period: "30d" }, steady), fixture.NOW);
    expect(off!.notes.join(" ")).toContain("Visit counting is off");
  });

  it("says plainly that there is nothing to explain for a store with no orders", async () => {
    const d = await insights.diagnosisFor(quiet, params({ period: "30d" }, quiet), fixture.NOW);
    expect(d!.explanation.direction).toBe("unknown");
    expect(d!.explanation.reason).toContain("no orders");
    expect(JSON.stringify(d)).not.toMatch(WORDS);
  });

  it("compares with last year when the address asks, and with the previous period when it asks for none", async () => {
    const year = await insights.diagnosisFor(steady, params({ period: "30d", compare: "year" }, steady), fixture.NOW);
    expect(year!.compare).toBe("year");
    expect(year!.comparedWith.from).toBe(addDays(year!.period.from, -365));
    const none = await insights.diagnosisFor(steady, params({ period: "30d", compare: "none" }, steady), fixture.NOW);
    expect(none!.compare).toBe("previous");
  });
});
