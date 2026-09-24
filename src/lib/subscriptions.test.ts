import { describe, expect, it } from "vitest";

import {
  addPeriods,
  basketShipping,
  commitmentEnd,
  nextCharge,
  pauseEnd,
  planPrice,
  planSummary,
  reminderDue,
  renewalState,
  sameRhythm,
  subscriptionStatusFor,
} from "./subscriptions";

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

  it("ships the first delivery of a free trial free; items bought once pay their own", () => {
    expect(basketShipping([line(22410, true)], rate, { trial: true })).toEqual({ first: 0, renewal: 9900 });
    expect(basketShipping([line(22410, true), line(24900, false)], rate, { trial: true })).toEqual({
      first: 9900,
      renewal: 9900,
    });
    // A trial of downloads: what renews costs nothing now and does not count towards free shipping.
    expect(basketShipping([line(90000, true, "digital"), line(24900, false)], rate, { trial: true })).toEqual({
      first: 9900,
      renewal: 0,
    });
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

const day = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

describe("addPeriods", () => {
  it("counts weeks in days and months by the calendar", () => {
    expect(addPeriods(day("2026-01-01"), "week", 2)).toEqual(day("2026-01-15"));
    expect(addPeriods(day("2026-01-15"), "month", 1, 3)).toEqual(day("2026-04-15"));
    expect(addPeriods(day("2026-03-10"), "year", 1)).toEqual(day("2027-03-10"));
  });

  it("keeps to the last day of a shorter month", () => {
    expect(addPeriods(day("2026-01-31"), "month", 1)).toEqual(day("2026-02-28"));
    expect(addPeriods(day("2028-01-31"), "month", 1)).toEqual(day("2028-02-29"));
    expect(addPeriods(day("2026-01-31"), "month", 1, 3)).toEqual(day("2026-04-30"));
  });
});

describe("pausing", () => {
  const periodEnd = day("2026-10-01");

  it("skipping one delivery lasts just past its charge", () => {
    expect(pauseEnd(periodEnd, "month", 1, 1)).toEqual(day("2026-10-02"));
    expect(nextCharge(periodEnd, pauseEnd(periodEnd, "month", 1, 1), "month", 1)).toEqual(day("2026-11-01"));
  });

  it("a pause of three deliveries charges again on the fourth", () => {
    const until = pauseEnd(periodEnd, "week", 2, 3);
    expect(nextCharge(periodEnd, until, "week", 2)).toEqual(day("2026-11-12"));
  });

  it("without a pause the next charge is the period's end", () => {
    expect(nextCharge(periodEnd, null, "month", 1)).toEqual(periodEnd);
  });
});

describe("commitmentEnd", () => {
  it("is the end of the period the last committed payment buys", () => {
    // Three payments committed, one made: two more, on 1 Nov and 1 Dec, so it ends 1 Jan.
    expect(commitmentEnd(day("2026-11-01"), "month", 1, 3, 1)).toEqual(day("2027-01-01"));
    // A free trial: none made yet, the first on the trial's end.
    expect(commitmentEnd(day("2026-10-15"), "month", 1, 2, 0)).toEqual(day("2026-12-15"));
  });

  it("is met once enough payments are made, or with no commitment", () => {
    expect(commitmentEnd(day("2026-11-01"), "month", 1, 3, 3)).toBeNull();
    expect(commitmentEnd(day("2026-11-01"), "month", 1, 0, 0)).toBeNull();
  });
});

describe("reminderDue", () => {
  const base = { interval: "month" as const, intervalCount: 1, trialEndsAt: null, remindedFor: null };

  it("reminds a week before a monthly renewal, once per charge", () => {
    const nextChargeAt = day("2026-10-08");
    expect(reminderDue(day("2026-09-30"), { ...base, nextChargeAt })).toBeNull();
    expect(reminderDue(day("2026-10-01"), { ...base, nextChargeAt })).toEqual({ kind: "renewal", chargeAt: nextChargeAt });
    expect(reminderDue(day("2026-10-02"), { ...base, nextChargeAt, remindedFor: nextChargeAt })).toBeNull();
  });

  it("reminds three days before a trial ends, even for weekly renewals", () => {
    const nextChargeAt = day("2026-10-08");
    const trial = { ...base, interval: "week" as const, nextChargeAt, trialEndsAt: nextChargeAt };
    expect(reminderDue(day("2026-10-04"), trial)).toBeNull();
    expect(reminderDue(day("2026-10-05"), trial)).toEqual({ kind: "trial", chargeAt: nextChargeAt });
  });

  it("does not remind before weekly renewals or after the charge", () => {
    expect(reminderDue(day("2026-10-06"), { ...base, interval: "week", nextChargeAt: day("2026-10-08") })).toBeNull();
    expect(reminderDue(day("2026-10-09"), { ...base, nextChargeAt: day("2026-10-08") })).toBeNull();
  });
});

describe("renewalState", () => {
  const sub = {
    interval: "month" as const,
    intervalCount: 1,
    currentPeriodEnd: "2026-10-01T09:00:00.000Z",
    pausedUntil: null,
    trialEndsAt: null,
    cancelAt: null,
    cancelAtPeriodEnd: false,
  };
  const now = day("2026-09-20");

  it("says what happens next", () => {
    expect(renewalState(sub, now)).toEqual({ kind: "renews", date: day("2026-10-01") });
    expect(renewalState({ ...sub, cancelAtPeriodEnd: true }, now)).toEqual({ kind: "ends", date: day("2026-10-01") });
    expect(renewalState({ ...sub, cancelAt: "2026-12-01T09:00:00.000Z" }, now)).toEqual({
      kind: "ends",
      date: day("2026-12-01"),
    });
    expect(renewalState({ ...sub, pausedUntil: "2026-11-02T09:00:00.000Z" }, now)).toEqual({
      kind: "paused",
      date: day("2026-12-01"),
    });
    expect(renewalState({ ...sub, trialEndsAt: "2026-10-01T09:00:00.000Z" }, now)).toEqual({
      kind: "trial",
      date: day("2026-10-01"),
    });
    expect(renewalState({ ...sub, currentPeriodEnd: null }, now)).toBeNull();
  });
});
