import { describe, expect, it } from "vitest";

import { challengeSchema } from "./autopilot-challenge";
import { originalPeriodSchema } from "./challenge-original";
import { adShare, ahead, board, originalSide, sideRatios, type Side } from "./challenge-scoreboard";

const period = (over: Record<string, unknown> = {}) =>
  originalPeriodSchema.parse({
    from: "2027-01-04",
    to: "2027-01-31",
    currency: "NOK",
    netSalesMinor: 100_000_00,
    cogsMinor: 45_000_00,
    shippingMinor: 8_000_00,
    paymentFeesMinor: 2_000_00,
    marketingMinor: 10_000_00,
    otherMinor: 5_000_00,
    sessions: 20_000,
    signedBy: "Revisor AS",
    signedOn: "2027-02-10",
    ...over,
  });

describe("the original's signed periods (E7)", () => {
  it("are read with their defaults, and a period that ends before it starts is refused", () => {
    expect(originalPeriodSchema.parse({ from: "2027-01-04", to: "2027-01-31", currency: "NOK", netSalesMinor: 1, cogsMinor: 0, signedBy: "A", signedOn: "2027-02-01" })).toMatchObject({
      marketingMinor: 0,
      sessions: null,
    });
    expect(originalPeriodSchema.safeParse({ ...period(), from: "2027-02-01" }).success).toBe(false);
  });

  it("add up to contribution after every cost, and refuse mixed currencies and overlaps", () => {
    const added = originalSide([period(), period({ from: "2027-02-01", to: "2027-02-28", sessions: null })]);
    expect(added).toMatchObject({ currency: "NOK", side: { netSalesMinor: 200_000_00, contributionMinor: 60_000_00, marketingMinor: 20_000_00, sessions: null } });
    expect(originalSide([period(), period({ from: "2027-02-01", to: "2027-02-28", currency: "EUR" })])).toMatchObject({ problem: expect.stringContaining("NOK and EUR") });
    expect(originalSide([period(), period({ from: "2027-01-20", to: "2027-02-10" })])).toMatchObject({ problem: expect.stringContaining("overlap") });
    expect(originalSide([])).toBeNull();
  });

  it("are kept with the challenge, which starts with none", () => {
    const c = challengeSchema.parse({ startsOn: "2027-01-04", dayOne: "2027-01-04", endsOn: "2027-04-13" });
    expect(c).toMatchObject({ original: [], adMoney: null });
    expect(challengeSchema.parse({ ...c, original: [period()] }).original).toHaveLength(1);
  });
});

describe("the board (3.3)", () => {
  const original: Side = { netSalesMinor: 100_000_00, contributionMinor: 30_000_00, marketingMinor: 10_000_00, sessions: 20_000 };

  it("works out each side's three ratios", () => {
    expect(sideRatios(original)).toEqual({ margin: 0.3, perKrone: 4, perVisitor: 500 });
    expect(sideRatios({ ...original, sessions: null, contributionMinor: null })).toEqual({ margin: null, perKrone: null, perVisitor: null });
  });

  it("names the store ahead on two of three, and who spent too little of the agreed ad money", () => {
    const clone: Side = { netSalesMinor: 60_000_00, contributionMinor: 21_000_00, marketingMinor: 6_000_00, sessions: 10_000 };
    const b = board(clone, original, 9_000_00);
    // Clone: margin 35 % against 30 %, per krone 4.5 against 4, per visitor 600 against 500.
    expect(b.ratios.margin).toMatchObject({ ahead: "clone" });
    expect(b.leader).toBe("clone");
    expect(b.ad).toEqual({ clone: 6_000_00 / 9_000_00, original: 10_000_00 / 9_000_00 });
    // 6 000 of 9 000 is under 80 %: the clone's lead does not count yet.
    expect(b.underSpent).toEqual(["clone"]);
  });

  it("has no leader while fewer than two ratios can be compared", () => {
    const clone: Side = { netSalesMinor: 60_000_00, contributionMinor: null, marketingMinor: 6_000_00, sessions: 10_000 };
    expect(board(clone, original, null)).toMatchObject({ leader: null, underSpent: [], ad: { clone: null, original: null } });
    expect(ahead(1, 1)).toBe("even");
    expect(adShare(1, 0)).toBeNull();
  });
});
