import { describe, expect, it } from "vitest";

import { campaignLift, dailySpread, forecast, observedLeadDays, seasonFactor, weightedPace, type ForecastInput } from "./demand-forecast";

const flat = (n: number, units: number) => Array.from({ length: n }, () => units);

const base: ForecastInput = {
  daily: flat(28, 2),
  lastYear: { before: [], ahead: [] },
  liftDaily: [],
  liftOnCampaign: [],
  plannedCampaignShare: 0,
  leadSamples: [],
  leadDaysAsked: 7,
  coverDays: 30,
  onHand: 20,
};

describe("the demand forecast (C4, D636)", () => {
  it("weighs the latest weeks more than older ones", () => {
    expect(weightedPace(flat(28, 3))).toBeCloseTo(3);
    // Three quiet weeks, then a busy one: above the plain average of 1.5, below the last week's 3.
    const rising = [...flat(21, 1), ...flat(7, 3)];
    expect(weightedPace(rising)).toBeGreaterThan(rising.reduce((a, b) => a + b, 0) / 28);
    expect(weightedPace(rising)).toBeLessThan(3);
    expect(weightedPace([])).toBe(0);
  });

  it("takes the season from last year only with enough of it, and clamps it", () => {
    expect(seasonFactor({ before: flat(28, 1), ahead: flat(37, 2) })).toBe(2);
    expect(seasonFactor({ before: flat(28, 1), ahead: flat(37, 9) })).toBe(2.5);
    expect(seasonFactor({ before: flat(28, 0.2), ahead: flat(37, 2) })).toBeNull();
    expect(seasonFactor({ before: [], ahead: [] })).toBeNull();
  });

  it("measures a product's lift in past campaigns only with enough campaign days and units", () => {
    const daily = [...flat(20, 1), ...flat(10, 3)];
    const on = [...flat(20, 0), ...flat(10, 1)].map(Boolean);
    expect(campaignLift(daily, on)).toBe(3);
    expect(campaignLift(daily.slice(0, 25), on.slice(0, 25))).toBeNull();
  });

  it("uses the supplier's own delivery time from at least two received orders", () => {
    expect(observedLeadDays([10.2, 12.5, 30])).toBe(13);
    expect(observedLeadDays([4])).toBeNull();
  });

  it("suggests the pace over cover and delivery plus a safety stock, less what is on hand", () => {
    const f = forecast(base);
    expect(f.perDay).toBe(2);
    expect(f.safety).toBe(0);
    expect(f.suggested).toBe(2 * 37 - 20);
    expect(f.lastsDays).toBe(10);
    expect(f.orderNow).toBe(false);
    expect(f.reasons).toEqual([]);
    // Units owed (below zero on hand) are added to what to order; it is time to order when the stock lasts no longer than the delivery.
    expect(forecast({ ...base, onHand: -3 })).toMatchObject({ suggested: 74 + 3, orderNow: true, lastsDays: 0 });
  });

  it("names each adjustment it used: the season, a planned campaign and the supplier's delivery time", () => {
    const f = forecast({
      ...base,
      lastYear: { before: flat(28, 1), ahead: flat(37, 1.5) },
      liftDaily: [...flat(170, 1), ...flat(10, 2)],
      liftOnCampaign: [...flat(170, 0), ...flat(10, 1)].map(Boolean),
      plannedCampaignShare: 0.5,
      leadSamples: [14, 14],
    });
    expect(f.leadDays).toBe(14);
    expect(f.perDay).toBe(4.5);
    expect(f.reasons).toEqual([
      "the season: ×1.5 from the same days last year",
      "a planned campaign: ×1.5 (this product sold ×2 in past campaigns)",
      "delivery: 14 days, as the supplier's last received orders took",
    ]);
    expect(forecast({ ...base, plannedCampaignShare: 0.3 }).reasons).toEqual(["a planned campaign, too few past campaigns to measure its lift"]);
  });

  it("keeps a safety stock for uneven days", () => {
    const uneven = Array.from({ length: 28 }, (_, i) => (i % 2 ? 4 : 0));
    expect(dailySpread(uneven)).toBeGreaterThan(1.9);
    expect(forecast({ ...base, daily: uneven }).safety).toBe(Math.ceil(1.65 * dailySpread(uneven) * Math.sqrt(7)));
  });
});
