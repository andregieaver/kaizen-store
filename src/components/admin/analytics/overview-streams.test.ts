import { createElement as h, Suspense } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/analytics-insights", () => ({
  alertsForStore: vi.fn(),
  diagnosisFor: vi.fn(),
  forecastForStore: vi.fn(),
  monthTargetMinor: vi.fn(),
  targetFrom: vi.fn(),
  dailyHistory: vi.fn(),
}));
vi.mock("@/server/analytics-totals", () => ({ topProducts: vi.fn() }));
vi.mock("@/server/analytics-traffic-data", () => ({ trafficReport: vi.fn(), marketingReport: vi.fn() }));

import { parseAnalyticsParams } from "@/lib/analytics-period";
import type { AnalyticsContext } from "@/server/analytics-context";
import { alertsForStore, dailyHistory, diagnosisFor, forecastForStore, monthTargetMinor } from "@/server/analytics-insights";
import { oncePerPeriod, overviewReads, type OverviewReads } from "@/server/analytics-overview-reads";
import { topProducts } from "@/server/analytics-totals";
import { marketingReport, trafficReport } from "@/server/analytics-traffic-data";

import { OverviewLayout, SectionSkeleton, SectionUnavailable, type OverviewFrame, type OverviewSlots } from "./overview-sections";
import { AlertsStream, ChannelsStream, DiagnosisStream, ForecastStream, FunnelStream, ProductsStream, Streamed, TargetStream, type StreamProps } from "./overview-streams";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const NOW = new Date("2026-10-15T10:00:00Z");
const params = parseAnalyticsParams({}, { now: NOW, timeZone: "Europe/Oslo" });
const frame: OverviewFrame = { base: "/admin/shop", currency: "NOK", locale: "nb-NO", isOwner: true, params };
const store = { id: "s1", slug: "shop", timeZone: "Europe/Oslo" } as unknown as AnalyticsContext["store"];
const ctx = { store, now: NOW, params, base: "/admin/shop", settings: {} } as unknown as AnalyticsContext;

const failing = () => Promise.reject(new Error("connection to 10.0.0.1 refused for customer anna@example.com"));
const stream = (reads: Partial<OverviewReads> = {}): StreamProps => ({
  ctx,
  frame,
  reads: { history: failing, traffic: failing, marketing: failing, ...reads },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Streamed", () => {
  it("draws what the loader gives", async () => {
    const out = html(await Streamed({ id: "x", title: "Best sellers", load: async () => 3, children: (n) => h("p", null, `value ${n}`) }));
    expect(out).toBe("<p>value 3</p>");
  });

  it("degrades to a calm note in its own place when the read fails, and logs only the kind of error", async () => {
    const out = html(await Streamed({ id: "overview-x", title: "Best sellers", load: failing, children: () => h("p", null, "never") }));
    expect(out).toContain('id="overview-x"');
    expect(out).toContain("Best sellers");
    expect(out).toContain("This part could not be loaded.");
    expect(out).toContain("Reload the page to try again.");
    expect(out).not.toContain("never");
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain("Error");
    expect(logged).not.toMatch(/10\.0\.0\.1|anna@example\.com/);
  });
});

describe("every streamed section", () => {
  it("never throws when its data cannot be read: each draws its note and none touches another", async () => {
    vi.mocked(alertsForStore).mockRejectedValue(new Error("x"));
    vi.mocked(forecastForStore).mockRejectedValue(new Error("x"));
    vi.mocked(diagnosisFor).mockRejectedValue(new Error("x"));
    vi.mocked(topProducts).mockRejectedValue(new Error("x"));
    vi.mocked(monthTargetMinor).mockRejectedValue(new Error("x"));
    const props = stream({ history: async () => ({ today: "2026-10-15", days: [] }) as never });
    const sections = [AlertsStream, TargetStream, ForecastStream, DiagnosisStream, FunnelStream, ProductsStream, ChannelsStream];
    for (const Section of sections) {
      const element = Section(props);
      const out = html(await (element.type as (p: unknown) => Promise<React.ReactElement>)(element.props));
      expect(out).toContain("This part could not be loaded.");
    }
  });
});

describe("the page's order and the places kept while loading", () => {
  const slots = (over: Partial<OverviewSlots> = {}): OverviewSlots => ({
    alerts: h("i", null, "alerts"),
    answer: h("i", null, "answer"),
    why: h("i", null, "why"),
    charts: h("i", null, "charts"),
    funnel: h("i", null, "funnel"),
    products: h("i", null, "products"),
    channels: h("i", null, "channels"),
    target: h("i", null, "target"),
    forecast: h("i", null, "forecast"),
    ...over,
  });

  it("keeps the order: needs you, the answer, why, charts, funnel, best sellers, channels, target, forecast", () => {
    const out = html(h(OverviewLayout, { currency: "NOK", slots: slots() }));
    const at = ["alerts", "answer", "why", "charts", "funnel", "products", "channels", "target", "forecast"].map((w) => out.indexOf(`<i>${w}</i>`));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(out).toContain("All amounts are in NOK without VAT.");
  });

  it("holds 'Needs you today' above the answer with a fixed-height placeholder while it loads", () => {
    const never = new Promise<never>(() => {});
    const Slow = () => {
      throw never;
    };
    const out = html(
      h(OverviewLayout, {
        currency: "NOK",
        slots: slots({ alerts: h(Suspense, { fallback: h(SectionSkeleton, { kind: "alerts", label: "what needs you today" }) }, h(Slow)) }),
      }),
    );
    expect(out).toContain('data-skeleton="alerts"');
    expect(out).toContain("Loading what needs you today");
    expect(out).toContain("h-32");
    expect(out.indexOf('data-skeleton="alerts"')).toBeLessThan(out.indexOf("<i>answer</i>"));
  });

  it("gives each placeholder a status role and a height of its own", () => {
    for (const kind of ["alerts", "why", "funnel", "products", "channels", "target", "forecast"] as const) {
      const out = html(h(SectionSkeleton, { kind, label: kind }));
      expect(out).toContain('role="status"');
      expect(out).toContain('aria-busy="true"');
      expect(out).toContain(`data-skeleton="${kind}"`);
      expect(out).toMatch(/h-(32|36|40|56|64|72)"/);
    }
  });

  it("words the failure note the same wherever it is drawn", () => {
    const out = html(h(SectionUnavailable, { id: "overview-funnel", title: "From visit to purchase" }));
    expect(out).toContain("From visit to purchase");
    expect(out).toContain("could not be loaded");
  });
});

describe("the reads sections share", () => {
  it("reads a period's report once however many sections ask, and a different period separately", async () => {
    const read = vi.fn(async (period: { from: string; to: string }) => period.from);
    const once = oncePerPeriod(read as never);
    const a = { ...params.period };
    const [x, y] = await Promise.all([once(a), once({ ...a })]);
    expect(x).toBe(y);
    await once({ ...a, from: "2026-01-01" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("starts nothing until a section asks, and reads the funnel's, the channels' and the history once per request", async () => {
    vi.mocked(dailyHistory).mockResolvedValue({ today: "2026-10-15", days: [] } as never);
    vi.mocked(trafficReport).mockResolvedValue({ sessions: 1 } as never);
    vi.mocked(marketingReport).mockResolvedValue({ table: null } as never);
    const reads = overviewReads(store, NOW, {} as never);
    expect(dailyHistory).not.toHaveBeenCalled();
    expect(trafficReport).not.toHaveBeenCalled();
    await Promise.all([reads.history(), reads.history(), reads.history(), reads.traffic(params.period), reads.traffic(params.period), reads.marketing(params.period), reads.marketing(params.period)]);
    expect(dailyHistory).toHaveBeenCalledTimes(1);
    expect(trafficReport).toHaveBeenCalledTimes(1);
    expect(marketingReport).toHaveBeenCalledTimes(1);
  });

  it("shares one failed read as one failure, for every section that asked", async () => {
    vi.mocked(trafficReport).mockRejectedValue(new Error("down"));
    const reads = overviewReads(store, NOW, {} as never);
    const results = await Promise.allSettled([reads.traffic(params.period), reads.traffic(params.period)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(trafficReport).toHaveBeenCalledTimes(1);
  });
});
