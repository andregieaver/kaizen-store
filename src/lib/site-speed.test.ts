import { describe, expect, it } from "vitest";

import { cruxRequest, readCrux, SPEED_FRESH_DAYS, speedBehind, speedRating, speedText, type SiteSpeedFacts } from "./site-speed";

/** How fast a site is (D905 M5c): the report's request and answer, Google's thresholds, and where a rival is good and the store poor. */

describe("the Chrome UX Report (D905 M5c)", () => {
  it("is asked for the three figures of an origin or a page, at its own address, with the key in the address", () => {
    const req = cruxRequest({ origin: "https://linnet.no" }, "AIza key");
    expect(req.url).toBe("https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=AIza%20key");
    expect(JSON.parse(req.body)).toEqual({
      origin: "https://linnet.no",
      metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"],
    });
    expect(JSON.parse(cruxRequest({ url: "https://kaizenaflow.com/s/linen" }, "k").body)).toMatchObject({ url: "https://kaizenaflow.com/s/linen" });
  });

  it("answers the 75th percentile of each, CLS in thousandths, and the last day covered", () => {
    const answer = {
      record: {
        key: { origin: "https://linnet.no" },
        metrics: {
          largest_contentful_paint: { histogram: [], percentiles: { p75: 2063 } },
          interaction_to_next_paint: { histogram: [], percentiles: { p75: 187 } },
          cumulative_layout_shift: { histogram: [], percentiles: { p75: "0.05" } },
        },
        collectionPeriod: { firstDate: { year: 2026, month: 10, day: 27 }, lastDate: { year: 2026, month: 11, day: 23 } },
      },
    };
    expect(readCrux(answer)).toEqual({ lcp: 2063, inp: 187, cls: 50, periodEnd: "2026-11-23" });
    expect(readCrux({ record: { metrics: { cumulative_layout_shift: { percentiles: { p75: "0.31" } } } } })).toEqual({ lcp: null, inp: null, cls: 310, periodEnd: null });
    expect(readCrux({ error: { code: 404 } })).toBeNull();
    expect(readCrux({ record: { metrics: {} } })).toBeNull();
  });
});

describe("Google's thresholds and a rival good where the store is poor (D905 M5c)", () => {
  it("rates each figure good, needing work or poor", () => {
    expect([speedRating("lcp", 2500), speedRating("lcp", 2501), speedRating("lcp", 4001)]).toEqual(["good", "needs", "poor"]);
    expect([speedRating("inp", 200), speedRating("inp", 500), speedRating("inp", 501)]).toEqual(["good", "needs", "poor"]);
    expect([speedRating("cls", 100), speedRating("cls", 250), speedRating("cls", 251)]).toEqual(["good", "needs", "poor"]);
  });

  it("writes seconds, milliseconds and the score as a person reads them", () => {
    expect(speedText("lcp", 2063)).toBe("2.1 s");
    expect(speedText("lcp", 4512, "nb-NO")).toBe("4,5 s");
    expect(speedText("inp", 187)).toBe("187 ms");
    expect(speedText("cls", 50)).toBe("0.05");
  });

  it("finds the best rival rated good where the store is poor, only from fresh figures", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    const site = (rivalName: string | null, over: Partial<SiteSpeedFacts> = {}): SiteSpeedFacts => ({
      host: `${rivalName ?? "own"}.no`,
      rivalName,
      lcp: 1800,
      inp: 150,
      cls: 50,
      checkedAt: "2026-11-24T10:00:00Z",
      periodEnd: "2026-11-22",
      problem: null,
      ...over,
    });
    const sites = [site(null, { lcp: 4800, inp: 600, cls: 40 }), site("Linnet", { lcp: 2100 }), site("Furu", { lcp: 1700, inp: 550 })];
    expect(speedBehind(sites, now)).toEqual([
      { metric: "lcp", rivalName: "Furu", theirs: 1700, yours: 4800 },
      { metric: "inp", rivalName: "Linnet", theirs: 150, yours: 600 },
    ]);
    const old = new Date(now.getTime() - (SPEED_FRESH_DAYS + 1) * 86_400_000).toISOString();
    expect(speedBehind([site(null, { lcp: 4800, checkedAt: old }), site("Linnet")], now)).toEqual([]);
    expect(speedBehind([site(null, { lcp: 4800 }), site("Linnet", { checkedAt: old })], now)).toEqual([]);
    expect(speedBehind([site("Linnet")], now)).toEqual([]);
  });
});
