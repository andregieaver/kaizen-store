import { describe, expect, it } from "vitest";

import { byPerson, forecast, forecastCurrencies, monthsFrom, stageConversion, timeToWin, type ClosedDeal, type OpenDeal } from "./sales-reports";

const open = (estimateMinor: number | null, expectedCloseOn: string | null, probability: number | null, currency = "NOK"): OpenDeal => ({ estimateMinor, currency, expectedCloseOn, probability });

describe("sales reports (S6, D519)", () => {
  it("forecasts open value by the month a deal may close, weighted by its stage's chance", () => {
    expect(monthsFrom("2026-11-09")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"]);
    const buckets = forecast(
      [open(100_000, "2026-10-20", 50), open(200_000, "2026-11-30", 50), open(300_000, "2026-11-01", null), open(null, "2027-01-10", 80), open(400_000, "2027-09-01", 20), open(500_000, null, 10), open(9_999, "2026-11-30", 50, "EUR")],
      "NOK",
      "2026-11-09",
    );
    expect(buckets.map((b) => b.key)).toEqual(["overdue", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "later", "none"]);
    const by = Object.fromEntries(buckets.map((b) => [b.key, b]));
    expect(by.overdue).toEqual({ key: "overdue", deals: 1, valueMinor: 100_000, weightedMinor: 50_000, unweighted: 0 });
    expect(by["2026-11"]).toEqual({ key: "2026-11", deals: 2, valueMinor: 500_000, weightedMinor: 100_000, unweighted: 1 });
    expect(by["2027-01"]).toMatchObject({ deals: 1, valueMinor: 0, unweighted: 1 });
    expect(by.later).toMatchObject({ deals: 1, valueMinor: 400_000, weightedMinor: 80_000 });
    expect(by.none).toMatchObject({ deals: 1, valueMinor: 500_000, weightedMinor: 50_000 });
    expect(by["2026-12"].deals).toBe(0);
    expect(forecastCurrencies([open(1, null, null, "EUR"), open(5, null, null, "SEK"), open(1, null, null, "NOK")], "NOK")).toEqual(["NOK", "SEK", "EUR"]);
  });

  it("counts how deals moved from stage to stage, a skipped stage passed and a won deal past them all", () => {
    const stages = ["new", "talking", "quote"];
    const result = stageConversion(stages, [
      { stages: ["new"], status: "lost" },
      { stages: ["new", "talking"], status: "open" },
      { stages: ["new", "quote"], status: "open" },
      { stages: ["talking"], status: "won" },
      { stages: [], status: "open" },
    ]);
    expect(result.steps.map((s) => [s.stageId, s.reached, s.onward])).toEqual([
      ["new", 4, 3 / 4],
      ["talking", 3, 2 / 3],
      ["quote", 2, 1 / 2],
    ]);
    expect([result.won, result.lost, result.open]).toEqual([1, 1, 3]);
    expect(stageConversion(["a"], []).steps).toEqual([{ stageId: "a", reached: 0, onward: null }]);
  });

  it("says what each person won and lost, and how long a deal takes to win", () => {
    const closed: ClosedDeal[] = [
      { ownerId: "eva", status: "won", estimateMinor: 100_000, currency: "NOK", createdAt: "2026-10-01T10:00:00Z", closedAt: "2026-10-11T10:00:00Z" },
      { ownerId: "eva", status: "lost", estimateMinor: 50_000, currency: "NOK", createdAt: "2026-10-01T10:00:00Z", closedAt: "2026-10-05T10:00:00Z" },
      { ownerId: "finn", status: "won", estimateMinor: 300_000, currency: "NOK", createdAt: "2026-09-01T10:00:00Z", closedAt: "2026-10-01T10:00:00Z" },
      { ownerId: "finn", status: "won", estimateMinor: 10_000, currency: "EUR", createdAt: "2026-10-01T10:00:00Z", closedAt: "2026-10-03T10:00:00Z" },
      { ownerId: null, status: "lost", estimateMinor: null, currency: "NOK", createdAt: "2026-10-01T10:00:00Z", closedAt: "2026-10-02T10:00:00Z" },
    ];
    expect(byPerson(closed, "NOK")).toEqual([
      { ownerId: "finn", won: 2, lost: 0, wonMinor: 300_000, winRate: 1 },
      { ownerId: "eva", won: 1, lost: 1, wonMinor: 100_000, winRate: 0.5 },
      { ownerId: null, won: 0, lost: 1, wonMinor: 0, winRate: 0 },
    ]);
    expect(timeToWin(closed)).toEqual({ median: 10, mean: 14, deals: 3 });
    expect(timeToWin([])).toEqual({ median: null, mean: null, deals: 0 });
  });
});
