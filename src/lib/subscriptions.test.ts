import { describe, expect, it } from "vitest";

import { basketShipping, planPrice, planSummary, sameRhythm, subscriptionStatusFor } from "./subscriptions";

const rate = { amountMinor: 9900, freeOverMinor: 99900 };

describe("planPrice", () => {
  it("takes the subscriber's discount off, rounded to the minor unit", () => {
    expect(planPrice(24900, 10)).toBe(22410);
    expect(planPrice(12900, 15)).toBe(10965);
    expect(planPrice(999, 0)).toBe(999);
  });
});

describe("basketShipping", () => {
  const line = (totalMinor: number, recurring: boolean, delivery: "physical" | "digital" = "physical") => ({
    totalMinor,
    recurring,
    delivery,
  });

  it("uses the usual rule on the whole basket without a subscription", () => {
    expect(basketShipping([line(50000, false), line(60000, false)], rate)).toEqual({ first: 0, renewal: 0 });
    expect(basketShipping([line(50000, false)], rate)).toEqual({ first: 9900, renewal: 0 });
  });

  it("charges a shipped subscription per delivery, on what each delivery holds", () => {
    // Items bought once travel with the first delivery.
    expect(basketShipping([line(22410, true), line(90000, false)], rate)).toEqual({ first: 9900, renewal: 9900 });
    expect(basketShipping([line(120000, true)], rate)).toEqual({ first: 0, renewal: 0 });
  });

  it("ships items bought once alongside a subscription to downloads, and nothing else", () => {
    expect(basketShipping([line(9900, true, "digital"), line(24900, false)], rate)).toEqual({ first: 9900, renewal: 0 });
    expect(basketShipping([line(9900, true, "digital")], rate)).toEqual({ first: 0, renewal: 0 });
    expect(basketShipping([line(24900, true)], null)).toEqual({ first: 0, renewal: 0 });
  });
});

describe("subscription status", () => {
  it("maps Stripe's statuses to Kaizen's", () => {
    expect(subscriptionStatusFor("trialing")).toBe("active");
    expect(subscriptionStatusFor("unpaid")).toBe("past_due");
    expect(subscriptionStatusFor("incomplete")).toBe("pending");
    expect(subscriptionStatusFor("incomplete_expired")).toBe("expired");
    expect(subscriptionStatusFor("canceled")).toBe("cancelled");
  });
});

describe("plans", () => {
  it("compares schedules and describes them for staff", () => {
    expect(sameRhythm({ interval: "month", intervalCount: 1 }, { interval: "month", intervalCount: 1 })).toBe(true);
    expect(sameRhythm({ interval: "month", intervalCount: 1 }, { interval: "week", intervalCount: 4 })).toBe(false);
    expect(planSummary({ interval: "week", intervalCount: 2, discountPercent: 10 })).toBe("Every 2 weeks, 10% off");
    expect(planSummary({ interval: "month", intervalCount: 1, discountPercent: 0 })).toBe("Every month");
  });
});
