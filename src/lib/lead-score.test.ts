import { describe, expect, it } from "vitest";

import { LEAD_RULES, leadLevel, leadScore, type LeadFacts } from "./lead-score";

const none: LeadFacts = { quotes: 0, openDeals: 0, presses30: 0, presses90: 0, viewed: 0 };

describe("a business customer's lead score (M2.8, D865)", () => {
  it("is nothing for someone who did nothing, and says no reason", () => {
    expect(leadScore(none)).toEqual({ score: 0, points: [] });
    expect(leadLevel(0)).toBe("none");
  });

  it("gives each reason its points, largest first, each within its most", () => {
    const s = leadScore({ ...none, quotes: 1, openDeals: 1, presses30: 1, viewed: 2 });
    expect(s.points).toEqual([
      { reason: "quotes", count: 1, points: 25 },
      { reason: "deal", count: 1, points: 20 },
      { reason: "pressed", count: 1, points: 10 },
      { reason: "viewed", count: 2, points: 10 },
    ]);
    expect(s.score).toBe(65);
    expect(leadLevel(s.score)).toBe("hot");
    expect(leadScore({ ...none, quotes: 9 }).points[0]).toEqual({ reason: "quotes", count: 9, points: LEAD_RULES.quotes.max });
  });

  it("counts an earlier press only when there is none this month, so one press is never counted twice", () => {
    expect(leadScore({ ...none, presses30: 2, presses90: 3 }).points.map((p) => p.reason)).toEqual(["pressed"]);
    expect(leadScore({ ...none, presses90: 3 })).toEqual({ score: 5, points: [{ reason: "pressedEarlier", count: 3, points: 5 }] });
    expect(leadLevel(5)).toBe("cool");
  });

  it("never passes 100, and reads warm from 25", () => {
    expect(leadScore({ quotes: 10, openDeals: 3, presses30: 10, presses90: 10, viewed: 10 }).score).toBe(100);
    expect(leadLevel(25)).toBe("warm");
    expect(leadLevel(59)).toBe("warm");
  });
});
