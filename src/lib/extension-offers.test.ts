import { describe, expect, it } from "vitest";

import { OFFER_EVERY_DAYS, QUIET_AFTER_NO_DAYS, offerCandidates, offerDue, type OfferFacts } from "./extension-offers";

/** The AI manager's extension suggestions (D748 E9, D852): only on a fact large enough, and not too often. */

const quiet: OfferFacts = { customerMessages7d: 0, subscribers: 0, leads30d: 0, pageViews30d: 0 };
const now = new Date("2026-11-20T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("offerCandidates", () => {
  it("offers nothing on a quiet store, and never Work", () => {
    expect(offerCandidates(quiet, ["support_desk", "email_automation", "deals", "ab_testing", "work"])).toEqual([]);
    expect(offerCandidates({ ...quiet, customerMessages7d: 999 }, ["work"])).toEqual([]);
  });

  it("offers each extension the account could try on its own fact, once the fact is large enough", () => {
    const busy: OfferFacts = { customerMessages7d: 42, subscribers: 199, leads30d: 12, pageViews30d: 8000 };
    expect(offerCandidates(busy, ["support_desk", "email_automation", "deals"])).toEqual([
      { extension: "support_desk", fact: { kind: "customerMessages7d", count: 42 } },
      { extension: "deals", fact: { kind: "leads30d", count: 12 } },
    ]);
    // Only what the account could try: one it has, or had a trial of, is not given.
    expect(offerCandidates(busy, ["deals"]).map((c) => c.extension)).toEqual(["deals"]);
  });
});

describe("offerDue", () => {
  it("offers what was never offered, and again only after 30 days", () => {
    expect(offerDue(undefined, now)).toBe(true);
    expect(offerDue({ offeredAt: daysAgo(OFFER_EVERY_DAYS - 1), declinedAt: null }, now)).toBe(false);
    expect(offerDue({ offeredAt: daysAgo(OFFER_EVERY_DAYS), declinedAt: null }, now)).toBe(true);
  });

  it("is quiet for 90 days after a no", () => {
    expect(offerDue({ offeredAt: daysAgo(60), declinedAt: daysAgo(QUIET_AFTER_NO_DAYS - 1) }, now)).toBe(false);
    expect(offerDue({ offeredAt: daysAgo(100), declinedAt: daysAgo(QUIET_AFTER_NO_DAYS) }, now)).toBe(true);
  });
});
