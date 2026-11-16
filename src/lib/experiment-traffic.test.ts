import { describe, expect, it } from "vitest";

import { eligiblePerDay, findableChange, goalEstimate, recommendedGoal, weeksOf, type TrafficFacts } from "./experiment-traffic";

const facts = (over: Partial<TrafficFacts> = {}): TrafficFacts => ({
  counting: true,
  days: 30,
  consentShare: 0.6,
  baselines: { orders: 0.02, cart: 0.09, checkout: 0.04 },
  targets: { front: { visitsPerDay: 250, basis: "landing" }, quiet: { visitsPerDay: 4, basis: "landing" }, unknown: { visitsPerDay: null, basis: null } },
  ...over,
});

describe("the store's own traffic", () => {
  it("counts only the visitors who accept statistics cookies as able to take part", () => {
    expect(eligiblePerDay(facts(), "front")).toBe(150);
    expect(eligiblePerDay(facts({ consentShare: null }), "front")).toBeNull();
    expect(eligiblePerDay(facts({ counting: false }), "front")).toBeNull();
    expect(eligiblePerDay(facts(), "unknown")).toBeNull();
  });

  it("works out how long a counted goal takes, with the results' own arithmetic", () => {
    const cart = goalEstimate({ facts: facts(), targetId: "front", goal: "cart", trafficShare: 1, versions: 2 })!;
    expect(cart.perVersion).toBeGreaterThan(1000);
    // About 2,800 visitors each at 150 a day: whole weeks, never fewer than the minimum.
    expect(cart.days % 7).toBe(0);
    expect(cart.days).toBeGreaterThanOrEqual(14);
    expect(weeksOf(cart)).toBe(cart.days / 7);
    // Half the visitors in the test takes about twice as long.
    const half = goalEstimate({ facts: facts(), targetId: "front", goal: "cart", trafficShare: 0.5, versions: 2 })!;
    expect(half.days).toBeGreaterThan(cart.days);
  });

  it("gives no estimate it cannot ground: a click, a form, revenue, or a rate nobody has", () => {
    for (const goal of ["click", "form", "revenue"] as const) expect(goalEstimate({ facts: facts(), targetId: "front", goal, trafficShare: 1, versions: 2 })).toBeNull();
    expect(goalEstimate({ facts: facts({ baselines: { orders: null, cart: 0.09, checkout: 0.04 } }), targetId: "front", goal: "orders", trafficShare: 1, versions: 2 })).toBeNull();
  });

  it("starts a busy page from orders and a quiet one from the cart, which answers sooner", () => {
    expect(recommendedGoal(facts({ targets: { busy: { visitsPerDay: 4000, basis: "site" } } }), "busy")).toBe("orders");
    expect(recommendedGoal(facts(), "front")).toBe("cart");
    // Nothing counted: orders, the plain default.
    expect(recommendedGoal(facts({ counting: false }), "front")).toBe("orders");
  });

  it("names the smallest change a quiet page could find within six weeks", () => {
    const quiet = facts({ targets: { slow: { visitsPerDay: 110, basis: "landing" } } });
    expect(goalEstimate({ facts: quiet, targetId: "slow", goal: "cart", trafficShare: 1, versions: 2 })!.tooLong).toBe(true);
    const found = findableChange({ facts: quiet, targetId: "slow", goal: "cart", trafficShare: 1, versions: 2 })!;
    expect(found.change).toBeGreaterThan(0.2);
    expect(found.estimate.tooLong).toBe(false);
    expect(findableChange({ facts: quiet, targetId: "quiet", goal: "cart", trafficShare: 1, versions: 2 })).toBeNull();
  });
});
