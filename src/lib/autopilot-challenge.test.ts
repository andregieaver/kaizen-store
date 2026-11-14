import { describe, expect, it } from "vitest";

import { autonomyDecision, DEFAULT_AUTONOMY, readAutonomy } from "./autopilot-autonomy";
import { CHALLENGE_LEVELS, challengeDay, challengeOn, challengeSchema, daysBetween, readChallenge, withChallenge } from "./autopilot-challenge";

const challenge = challengeSchema.parse({ startsOn: "2026-12-14", dayOne: "2027-01-04", endsOn: "2027-05-13" });

describe("the challenge's dates", () => {
  it("reads a challenge with its defaults", () => {
    expect(challenge).toMatchObject({ broadcastsPerWeek: 2, supportRepliesPerDay: 200, aiMonthlyUsd: 300, priceChangePercent: 15, discountPercent: 20 });
  });

  it("refuses dates in the wrong order and runs that are too long", () => {
    expect(challengeSchema.safeParse({ startsOn: "2027-01-05", dayOne: "2027-01-04", endsOn: "2027-04-13" }).success).toBe(false);
    expect(challengeSchema.safeParse({ startsOn: "2027-01-04", dayOne: "2027-01-04", endsOn: "2027-01-03" }).success).toBe(false);
    expect(challengeSchema.safeParse({ startsOn: "2026-10-01", dayOne: "2027-01-04", endsOn: "2027-04-13" }).success).toBe(false);
    expect(challengeSchema.safeParse({ startsOn: "2027-01-04", dayOne: "2027-01-04", endsOn: "2027-12-31" }).success).toBe(false);
    // Day 1 to Day 130 is the longest.
    expect(challengeSchema.safeParse({ startsOn: "2027-01-04", dayOne: "2027-01-04", endsOn: "2027-05-13" }).success).toBe(true);
    expect(challengeSchema.safeParse({ startsOn: "2027-01-04", dayOne: "2027-01-04", endsOn: "2027-05-14" }).success).toBe(false);
  });

  it("is on from its first day to its last, both included", () => {
    expect(challengeOn(challenge, "2026-12-13")).toBe(false);
    expect(challengeOn(challenge, "2026-12-14")).toBe(true);
    expect(challengeOn(challenge, "2027-05-13")).toBe(true);
    expect(challengeOn(challenge, "2027-05-14")).toBe(false);
    expect(challengeOn(null, "2027-01-04")).toBe(false);
  });

  it("counts Day 1 as 1 and the rehearsal before it", () => {
    expect(challengeDay(challenge, "2027-01-04")).toBe(1);
    expect(challengeDay(challenge, "2027-04-13")).toBe(100);
    expect(challengeDay(challenge, "2027-01-03")).toBe(0);
    expect(daysBetween("2027-01-04", "2027-04-13")).toBe(99);
  });

  it("reads nothing it cannot read", () => {
    expect(readChallenge(null)).toBeNull();
    expect(readChallenge({ startsOn: "soon" })).toBeNull();
    expect(readChallenge(challenge)).toEqual(challenge);
  });
});

describe("the settings in force", () => {
  it("are the owner's when no challenge is on", () => {
    const own = readAutonomy({ levels: { catalogue: "tell" } });
    expect(withChallenge(own, challenge, "2026-12-01")).toEqual({ ...own, challenge: null });
    expect(withChallenge(own, null, "2027-01-10").levels).toEqual({ catalogue: "tell" });
  });

  it("are the challenge's preset while it is on, the pause still the owner's", () => {
    const own = readAutonomy({ paused: true, levels: { catalogue: "ask" }, budgets: { customerEmailsPerWeek: 3 } });
    const on = withChallenge(own, challenge, "2027-01-10");
    expect(on.levels).toEqual(CHALLENGE_LEVELS);
    expect(on.planning).toMatchObject({ continues: true, starts: "auto", reacts: true, reviewDays: 3, plansPerWeek: 10, waitMinutes: 5 });
    expect(on.budgets).toMatchObject({ aiMonthlyUsd: 300, priceChangePercent: 15, discountPercent: 20, customerEmailsPerWeek: 3 });
    expect(on.paused).toBe(true);
    expect(on.challenge).toMatchObject({ active: true, day: 7, broadcastsPerWeek: 2, supportRepliesPerDay: 200 });
  });

  it("never takes challenge mode from what an owner's form sends", () => {
    expect(readAutonomy({ challenge: { active: true, broadcastsPerWeek: 9 } }).challenge).toBeNull();
  });
});

describe("decisions in challenge mode", () => {
  const on = withChallenge(DEFAULT_AUTONOMY, challenge, "2027-01-10");

  it("sends a broadcast itself within the week's budget, and asks past it", () => {
    expect(autonomyDecision(on, "send_broadcast", "send", { broadcastsThisWeek: 1 })).toEqual({ run: true, tell: false, area: "marketing" });
    expect(autonomyDecision(on, "send_broadcast", "send", { broadcastsThisWeek: 2 })).toMatchObject({ run: false });
    expect(autonomyDecision(on, "send_broadcast", "send", {})).toMatchObject({ run: false });
    // Outside the challenge a broadcast always asks (D334).
    expect(autonomyDecision(DEFAULT_AUTONOMY, "send_broadcast", "send", { broadcastsThisWeek: 0 })).toMatchObject({ run: false });
  });

  it("answers customers on the desk within the day's budget, not the week's emails", () => {
    expect(autonomyDecision(on, "reply_to_support", "send", { supportRepliesToday: 199, customerEmailsThisWeek: 50 })).toMatchObject({ run: true });
    expect(autonomyDecision(on, "reply_to_support", "send", { supportRepliesToday: 200 })).toMatchObject({ run: false });
    // An email outside the desk still meets the weekly email budget.
    expect(autonomyDecision(on, "email_customer", "send", { customerEmailsThisWeek: 5 })).toMatchObject({ run: false });
  });

  it("still keeps refunds and every other money back to a customer for the person", () => {
    for (const tool of ["refund_order", "adjust_customer_credits", "issue_gift_card", "process_exchange", "change_order"]) {
      expect(autonomyDecision(on, tool, "spend", {})).toMatchObject({ run: false });
    }
  });

  it("runs what the preset's levels allow, within the challenge's budgets", () => {
    expect(autonomyDecision(on, "publish_page", "public", {})).toEqual({ run: true, tell: false, area: "website" });
    expect(autonomyDecision(on, "make_theme_live", "public", { costsMoney: false })).toEqual({ run: true, tell: true, area: "design" });
    expect(autonomyDecision(on, "set_prices", "public", { priceChangePercent: 15, lowestMarginPercent: 30 })).toMatchObject({ run: true });
    expect(autonomyDecision(on, "set_prices", "public", { priceChangePercent: 16, lowestMarginPercent: 30 })).toMatchObject({ run: false });
    // The challenge's margin floor (10 % by default) holds too.
    expect(autonomyDecision(on, "set_prices", "public", { priceChangePercent: 5, lowestMarginPercent: 8 })).toMatchObject({ run: false });
  });
});
